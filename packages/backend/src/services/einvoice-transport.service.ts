// E-invoice transport orchestrator: queue, state machine, retries, inbox
// handoff. Knows nothing about HTTP — the active `EinvoiceTransport` driver
// owns that. This is where the business rules live and where the tests
// concentrate, all exercised through the fake driver with no network.

import crypto from "node:crypto";
import { getDb } from "../database/connection";
import { logger } from "../utils/logger";
import { buildXmlInvoiceData } from "../xml/build-data";
import { logActivity } from "./activity.service";
import { emitEinvoice } from "./einvoice.service";
import { importEinvoiceFile } from "./einvoice-inbox.service";
import {
  getActiveTransport,
  getFranceTransport,
  listEnabledTransports,
} from "./einvoice-transports/registry";
import {
  type EinvoiceTransport,
  type ParticipantCapability,
  type ParticipantId,
  type ParticipantStatus,
  type RegisterParticipantRequest,
  type RegistrationState,
  type SendContext,
  type TransmissionStatus,
  TransportHttpError,
  type TransportWebhookRequest,
  type TransportWebhookResult,
} from "./einvoice-transports/types";
import { validateEinvoice } from "./einvoice-validator.service";
import { dispatchEvent } from "./outgoing-webhooks.service";
import { getSetting } from "./settings.service";

/** Retry backoff in minutes, one entry per attempt after attempt N failed. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 6 * 60, 24 * 60];
/** After this many failed attempts the transmission goes terminal. */
const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1; // 7
/** Rows processed per worker tick, sequential. */
const QUEUE_BATCH_SIZE = 25;
/** Inbound document size cap, before anything touches SQLite. */
const MAX_INBOUND_BYTES = 10 * 1024 * 1024;

export interface TransmissionRow {
  id: string;
  invoice_id: string;
  einvoice_document_id: string;
  transport_id: string;
  document_type: string;
  sender_scheme: string;
  sender_id: string;
  receiver_scheme: string;
  receiver_id: string;
  status: TransmissionStatus;
  status_detail: string | null;
  provider_message_id: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  delivered_at: string | null;
}

export interface TransmissionAttemptRow {
  id: string;
  transmission_id: string;
  attempt_number: number;
  status_code: number | null;
  error_message: string | null;
  response_body: string | null;
  created_at: string;
}

export type EnqueueResult =
  | { ok: true; transmissionId: string }
  | { ok: false; code: string; status: 404 | 409 | 422; error: string; issues?: unknown[] };

// ---------- enqueue (trigger path, §9.1 / §9.2) ----------

export async function enqueueTransmission(invoiceId: string): Promise<EnqueueResult> {
  const db = getDb();

  const peppolTransport = getActiveTransport();
  const franceTransport = getFranceTransport();
  if (!peppolTransport && !franceTransport) {
    return {
      ok: false,
      code: "peppol_not_configured",
      status: 409,
      error: "PEPPOL is not configured or enabled.",
    };
  }

  const invoice = db
    .query(
      `SELECT i.id, i.type, i.invoice_number, i.customer_id, c.einvoice_receiver_scheme,
              c.einvoice_receiver_id, c.siren
       FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.id = ? AND i.deleted_at IS NULL`,
    )
    .get(invoiceId) as {
    id: string;
    type: string;
    invoice_number: string;
    customer_id: string;
    einvoice_receiver_scheme: string | null;
    einvoice_receiver_id: string | null;
    siren: string | null;
  } | null;
  if (!invoice) {
    return { ok: false, code: "NOT_FOUND", status: 404, error: "Invoice not found" };
  }

  // France: recipient is identified by SIREN and the tenant's own SIREN is
  // the sender identity. Priority: France when the customer has a SIREN and
  // the network is on; PEPPOL otherwise.
  const useFrance = !!invoice.siren && !!franceTransport;
  let transport: EinvoiceTransport;
  let receiver: ParticipantId;
  let emitFormat: "zugferd" | "peppol";
  if (useFrance) {
    const senderSiren = getSetting("france_sender_siren");
    if (!senderSiren) {
      return {
        ok: false,
        code: "france_sender_missing",
        status: 422,
        error: "No sender SIREN configured for France e-invoicing (Settings → France).",
      };
    }
    transport = franceTransport!;
    receiver = { scheme: "0009", value: invoice.siren! };
    emitFormat = "zugferd";
  } else {
    if (!invoice.einvoice_receiver_id || !invoice.einvoice_receiver_scheme) {
      return {
        ok: false,
        code: "receiver_id_missing",
        status: 422,
        error: "The customer has no PEPPOL receiver identifier. Add it on the customer form first.",
        issues: [{ customer_id: invoice.customer_id }],
      };
    }
    if (!peppolTransport) {
      return {
        ok: false,
        code: "peppol_not_configured",
        status: 409,
        error: "PEPPOL is not configured or enabled.",
      };
    }
    transport = peppolTransport;
    receiver = { scheme: invoice.einvoice_receiver_scheme, value: invoice.einvoice_receiver_id };
    emitFormat = "peppol";
  }

  const senderScheme = useFrance ? "0009" : (getSetting("peppol_sender_scheme") ?? "");
  const senderId = useFrance
    ? (getSetting("france_sender_siren") ?? "")
    : (getSetting("peppol_sender_id") ?? "");
  if (!senderScheme || !senderId) {
    return {
      ok: false,
      code: "sender_id_missing",
      status: 422,
      error: useFrance
        ? "No sender SIREN configured for France e-invoicing (Settings → France)."
        : "No sender PEPPOL identity configured. Set it under Settings → PEPPOL.",
    };
  }

  const data = buildXmlInvoiceData(invoiceId);
  const blocking = validateEinvoice(data).filter((i) => i.severity === "error");
  if (blocking.length > 0) {
    return {
      ok: false,
      code: "validation_failed",
      status: 422,
      error: "The invoice does not pass e-invoice validation.",
      issues: blocking,
    };
  }

  // A non-terminal transmission on the invoice's latest emitted document means
  // a send is already in flight — refuse rather than duplicate.
  const latestDoc = db
    .query(
      "SELECT id FROM einvoice_documents WHERE invoice_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(invoiceId) as { id: string } | null;
  if (latestDoc) {
    const inFlight = db
      .query(
        `SELECT id FROM einvoice_transmissions
         WHERE einvoice_document_id = ? AND status IN ('queued', 'sending', 'sent') LIMIT 1`,
      )
      .get(latestDoc.id);
    if (inFlight) {
      return {
        ok: false,
        code: "already_in_flight",
        status: 409,
        error: "This document is already being transmitted.",
      };
    }
  }

  const documentType = invoice.type === "credit_note" ? "credit-note" : "invoice";

  // Receiver capability is checked before any row exists, so an unreachable
  // receiver never leaves a corpse transmission behind.
  let capability: ParticipantCapability;
  try {
    capability = await transport.lookupParticipant(receiver);
    const cacheUpdate = useFrance
      ? "UPDATE customers SET france_checked_at = datetime('now'), france_reachable = ? WHERE id = ?"
      : "UPDATE customers SET peppol_checked_at = datetime('now'), peppol_reachable = ? WHERE id = ?";
    getDb()
      .query(cacheUpdate)
      .run(capability.exists ? 1 : 0, invoice.customer_id);
  } catch (err) {
    logger.warn(
      { err, receiver },
      useFrance
        ? "France receiver lookup failed during enqueue"
        : "PEPPOL receiver lookup failed during enqueue",
    );
    return {
      ok: false,
      code: "receiver_unreachable",
      status: 422,
      error: useFrance
        ? "Could not verify the receiver on the Annuaire (via Qonto)."
        : "Could not verify the receiver on the PEPPOL network.",
    };
  }
  if (!capability.exists || !capability.documentTypes.includes(documentType)) {
    return {
      ok: false,
      code: "receiver_unreachable",
      status: 422,
      error: useFrance
        ? "The receiver is not registered for e-invoicing on the Annuaire (via Qonto)."
        : "The receiver is not reachable on the PEPPOL network for this document type.",
    };
  }

  // Emit a fresh PEPPOL document revision. Re-emission on repeat sends is
  // deliberate: the transmitted bytes are always the archived bytes, and each
  // transmission is a different legal document.
  let emitted: Awaited<ReturnType<typeof emitEinvoice>>;
  try {
    emitted = await emitEinvoice(invoiceId, { forceFormat: emitFormat });
  } catch (err) {
    return {
      ok: false,
      code: "emission_failed",
      status: 422,
      error: err instanceof Error ? err.message : "E-invoice emission failed.",
    };
  }

  const transmissionId = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  db.run(
    `INSERT INTO einvoice_transmissions
       (id, invoice_id, einvoice_document_id, transport_id, document_type,
        sender_scheme, sender_id, receiver_scheme, receiver_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')`,
    [
      transmissionId,
      invoiceId,
      emitted.id,
      transport.id,
      documentType,
      senderScheme,
      senderId,
      receiver.scheme,
      receiver.value,
    ],
  );

  return { ok: true, transmissionId };
}

// ---------- queue worker (§9.3) ----------

let workerTimer: ReturnType<typeof setInterval> | null = null;

export function startTransportWorker(intervalMs = 60_000): void {
  if (workerTimer) return;
  void processTransportQueue().catch((err) =>
    logger.error({ err }, "Transport worker initial tick failed"),
  );
  workerTimer = setInterval(() => {
    void processTransportQueue().catch((err) =>
      logger.error({ err }, "Transport worker tick failed"),
    );
  }, intervalMs);
  logger.info({ intervalSec: intervalMs / 1000 }, "Transport worker started");
}

export function stopTransportWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

export async function processTransportQueue(): Promise<{ processed: number }> {
  const db = getDb();
  const transports = listEnabledTransports();
  if (transports.length === 0) return { processed: 0 };
  const transportById = new Map(transports.map((t) => [t.id, t]));

  const rows = db
    .query(
      `SELECT * FROM einvoice_transmissions
       WHERE status IN ('queued', 'sending')
         AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
       ORDER BY created_at LIMIT ?`,
    )
    .all(QUEUE_BATCH_SIZE) as unknown as TransmissionRow[];

  for (const row of rows) {
    const transport = transportById.get(row.transport_id);
    if (!transport) continue; // network disabled mid-flight; row stays queued
    try {
      await processTransmission(row, transport);
    } catch (err) {
      logger.error({ err, transmissionId: row.id }, "Transmission processing crashed");
    }
  }
  return { processed: rows.length };
}

async function processTransmission(
  row: TransmissionRow,
  transport: EinvoiceTransport,
): Promise<void> {
  const db = getDb();
  const attemptNumber = row.attempt_count + 1;

  db.run(
    `UPDATE einvoice_transmissions SET status = 'sending', attempt_count = ?,
            updated_at = datetime('now') WHERE id = ?`,
    [attemptNumber, row.id],
  );

  const doc = db
    .query("SELECT xml_content, hash FROM einvoice_documents WHERE id = ?")
    .get(row.einvoice_document_id) as { xml_content: string | null; hash: string } | null;
  const invoice = db
    .query("SELECT invoice_number FROM invoices WHERE id = ?")
    .get(row.invoice_id) as { invoice_number: string } | null;

  if (!doc?.xml_content || !invoice) {
    recordAttempt(row.id, attemptNumber, null, "Document or invoice vanished before send", null);
    failTransmission(row.id, "Document or invoice vanished before send");
    return;
  }

  const ctx: SendContext = {
    transmissionId: row.id,
    sender: { scheme: row.sender_scheme, value: row.sender_id },
    receiver: { scheme: row.receiver_scheme, value: row.receiver_id },
    documentType: row.document_type === "credit-note" ? "credit-note" : "invoice",
    xml: doc.xml_content,
    hash: doc.hash,
    documentNumber: invoice.invoice_number,
    data: buildXmlInvoiceData(row.invoice_id),
  };

  try {
    const receipt = await transport.send(ctx);
    db.run(
      `UPDATE einvoice_transmissions SET status = 'sent', provider_message_id = ?,
              status_detail = NULL, sent_at = datetime('now'), next_attempt_at = NULL,
              updated_at = datetime('now') WHERE id = ?`,
      [receipt.providerMessageId, row.id],
    );
    recordAttempt(row.id, attemptNumber, 202, null, null);
    void dispatchEvent("einvoice.transmitted", {
      invoice_id: row.invoice_id,
      transmission_id: row.id,
      invoice_number: invoice.invoice_number,
      transport_id: transport.id,
    });
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transport send failed";
    const statusCode = err instanceof TransportHttpError ? err.statusCode : null;
    const responseBody = err instanceof TransportHttpError ? err.responseBody : null;
    recordAttempt(row.id, attemptNumber, statusCode, message, responseBody);

    const retryable = err instanceof TransportHttpError ? err.isRetryable() : true;
    if (!retryable || attemptNumber >= MAX_ATTEMPTS) {
      failTransmission(row.id, message, statusCode, responseBody);
    } else {
      const delayMinutes =
        BACKOFF_MINUTES[attemptNumber - 1] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1];
      db.run(
        `UPDATE einvoice_transmissions SET status = 'queued', status_detail = ?,
                next_attempt_at = datetime('now', '+' || ? || ' minutes'),
                updated_at = datetime('now') WHERE id = ?`,
        [message, String(delayMinutes), row.id],
      );
      logger.warn(
        { transmissionId: row.id, attemptNumber, delayMinutes, message },
        "Transmission retry scheduled",
      );
    }
  }
}

function recordAttempt(
  transmissionId: string,
  attemptNumber: number,
  statusCode: number | null,
  errorMessage: string | null,
  responseBody: string | null,
): void {
  const db = getDb();
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  db.run(
    `INSERT INTO einvoice_transmission_attempts
       (id, transmission_id, attempt_number, status_code, error_message, response_body)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      transmissionId,
      attemptNumber,
      statusCode,
      errorMessage,
      responseBody ? responseBody.slice(0, 4000) : null,
    ],
  );
}

function failTransmission(
  transmissionId: string,
  message: string,
  statusCode: number | null = null,
  responseBody: string | null = null,
): void {
  const db = getDb();
  const row = db
    .query("SELECT invoice_id FROM einvoice_transmissions WHERE id = ?")
    .get(transmissionId) as { invoice_id: string } | null;
  db.run(
    `UPDATE einvoice_transmissions SET status = 'failed', status_detail = ?,
            next_attempt_at = NULL, updated_at = datetime('now') WHERE id = ?`,
    [message, transmissionId],
  );
  if (row) {
    logActivity({
      action: "transmission_failed",
      resource_type: "invoice",
      resource_id: row.invoice_id,
      metadata: { transmission_id: transmissionId, detail: message, status_code: statusCode },
    });
    void dispatchEvent("einvoice.failed", {
      invoice_id: row.invoice_id,
      transmission_id: transmissionId,
      detail: message,
      status_code: statusCode,
      response_body: responseBody,
    });
  }
}

// ---------- transmission management (routes) ----------

export function listTransmissions(invoiceId: string): {
  transmissions: (TransmissionRow & { invoice_number: string })[];
  attempts: Record<string, TransmissionAttemptRow[]>;
} {
  const db = getDb();
  const transmissions = db
    .query(
      `SELECT t.*, i.invoice_number FROM einvoice_transmissions t
       JOIN invoices i ON i.id = t.invoice_id
       WHERE t.invoice_id = ? ORDER BY t.created_at DESC`,
    )
    .all(invoiceId) as unknown as (TransmissionRow & { invoice_number: string })[];
  const attempts: Record<string, TransmissionAttemptRow[]> = {};
  for (const t of transmissions) {
    attempts[t.id] = db
      .query(
        "SELECT * FROM einvoice_transmission_attempts WHERE transmission_id = ? ORDER BY attempt_number",
      )
      .all(t.id) as unknown as TransmissionAttemptRow[];
  }
  return { transmissions, attempts };
}

export function retryTransmission(id: string): boolean {
  const db = getDb();
  const res = db
    .query(
      `UPDATE einvoice_transmissions SET status = 'queued', status_detail = NULL,
              attempt_count = 0, next_attempt_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND status = 'failed'`,
    )
    .run(id);
  return Number(res.changes) > 0;
}

export function cancelTransmission(id: string): boolean {
  const db = getDb();
  // Only queued rows can be cancelled — anything already handed to the
  // provider must run its course.
  const res = db
    .query("DELETE FROM einvoice_transmissions WHERE id = ? AND status = 'queued'")
    .run(id);
  return Number(res.changes) > 0;
}

// ---------- participant registration (§10) ----------

export interface ParticipantRow {
  id: string;
  transport_id: string;
  scheme: string;
  identifier: string;
  role: string;
  status: ParticipantStatus;
  status_detail: string | null;
  provider_ref: string | null;
  action_url: string | null;
  registered_at: string | null;
  created_at: string;
  updated_at: string;
}

export function getCurrentParticipant(): ParticipantRow | null {
  const transport = getActiveTransport();
  if (!transport) return null;
  const row = getDb()
    .query(
      `SELECT * FROM peppol_participants WHERE transport_id = ? AND role = 'receiver'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(transport.id) as unknown as ParticipantRow | undefined;
  return row ?? null;
}

export async function registerReceiver(
  req: RegisterParticipantRequest,
): Promise<RegistrationState> {
  const transport = getActiveTransport();
  if (!transport) {
    throw new TransportError(409, "peppol_not_configured", "PEPPOL is not configured or enabled.");
  }

  // 1. Check before registering (§10.2). Never attempt a takeover: a
  // participant served by another access point stays where it is.
  let capability: ParticipantCapability;
  try {
    capability = await transport.lookupParticipant(req.participant);
  } catch (err) {
    throw new TransportError(
      502,
      "lookup_failed",
      err instanceof Error ? err.message : "Participant lookup failed.",
    );
  }
  if (capability.exists && capability.servedElsewhere) {
    const detail = capability.accessPointName
      ? `This business is already registered with ${capability.accessPointName}. Contact that access point to deregister, then retry here.`
      : "This business is already registered with another access point. Contact it to deregister, then retry here.";
    upsertParticipant(transport.id, req.participant, "receiver", "conflict", detail, null, null);
    return { providerRef: "", status: "conflict", actionUrl: null, detail };
  }

  // 2. Register (or adopt the existing registration when the provider already
  // serves this participant).
  let state: RegistrationState;
  try {
    state = await transport.registerParticipant(req);
  } catch (err) {
    throw new TransportError(
      502,
      "registration_failed",
      err instanceof Error ? err.message : "Registration failed.",
    );
  }

  upsertParticipant(
    transport.id,
    req.participant,
    "receiver",
    state.status,
    state.detail,
    state.providerRef,
    state.actionUrl,
  );
  return state;
}

export async function refreshParticipant(): Promise<RegistrationState | null> {
  const transport = getActiveTransport();
  const current = getCurrentParticipant();
  if (!transport || !current?.provider_ref) return null;
  const state = await transport.getRegistration(current.provider_ref);
  upsertParticipant(
    transport.id,
    { scheme: current.scheme, value: current.identifier },
    "receiver",
    state.status,
    state.detail,
    state.providerRef,
    state.actionUrl,
  );
  return state;
}

export async function deregisterParticipant(): Promise<boolean> {
  const transport = getActiveTransport();
  const current = getCurrentParticipant();
  if (!transport || !current?.provider_ref) return false;
  await transport.deregisterParticipant(current.provider_ref);
  getDb()
    .query(
      `UPDATE peppol_participants SET status = 'deregistered', status_detail = 'Deregistered on request.',
              registered_at = NULL, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(current.id);
  return true;
}

function upsertParticipant(
  transportId: string,
  participant: ParticipantId,
  role: string,
  status: ParticipantStatus,
  detail: string | null,
  providerRef: string | null,
  actionUrl: string | null,
): void {
  const db = getDb();
  const existing = db
    .query(
      `SELECT id FROM peppol_participants
       WHERE transport_id = ? AND scheme = ? AND identifier = ? AND role = ?`,
    )
    .get(transportId, participant.scheme, participant.value, role) as { id: string } | null;

  const registeredAt = status === "active" ? "datetime('now')" : "NULL";
  if (existing) {
    db.query(
      `UPDATE peppol_participants
       SET status = ?, status_detail = ?, provider_ref = ?, action_url = ?,
           registered_at = COALESCE(registered_at, ${registeredAt}), updated_at = datetime('now')
       WHERE id = ?`,
    ).run(status, detail, providerRef, actionUrl, existing.id);
  } else {
    db.query(
      `INSERT INTO peppol_participants
         (id, transport_id, scheme, identifier, role, status, status_detail,
          provider_ref, action_url, registered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${registeredAt})`,
    ).run(
      crypto.randomUUID().replace(/-/g, "").slice(0, 32),
      transportId,
      participant.scheme,
      participant.value,
      role,
      status,
      detail,
      providerRef,
      actionUrl,
    );
  }
}

export async function lookupParticipant(
  participant: ParticipantId,
  customerId?: string,
): Promise<ParticipantCapability> {
  const transport = getActiveTransport();
  if (!transport) {
    throw new TransportError(409, "peppol_not_configured", "PEPPOL is not configured or enabled.");
  }
  let capability: ParticipantCapability;
  try {
    capability = await transport.lookupParticipant(participant);
  } catch (err) {
    throw new TransportError(
      502,
      "lookup_failed",
      err instanceof Error ? err.message : "Participant lookup failed.",
    );
  }
  if (customerId) {
    getDb()
      .query(
        "UPDATE customers SET peppol_checked_at = datetime('now'), peppol_reachable = ? WHERE id = ?",
      )
      .run(capability.exists ? 1 : 0, customerId);
  }
  return capability;
}

// ---------- inbound webhooks (§11) ----------

/** Thrown by the inbound handler when a payload exceeds the size cap. */
export class TransportWebhookSizeError extends Error {}

export async function handleTransportWebhook(
  req: TransportWebhookRequest,
  transport?: EinvoiceTransport,
): Promise<TransportWebhookResult> {
  const active = transport ?? getActiveTransport();
  if (!active) throw new Error("No active transport");

  // Verification and normalisation live in the driver; persistence lives here.
  const result = await active.parseWebhook(req);

  // Replay guard: the provider event id is the primary key. A duplicate means
  // we already handled this event, so acknowledge and stop.
  const db = getDb();
  try {
    db.query("INSERT INTO einvoice_webhook_events (id, transport_id) VALUES (?, ?)").run(
      result.eventId,
      active.id,
    );
  } catch {
    return { kind: "ignored", eventId: result.eventId };
  }

  switch (result.kind) {
    case "document":
      await handleInboundDocument(result, active);
      return result;
    case "status":
      handleInboundStatus(result);
      return result;
    case "participant":
      handleInboundParticipant(result);
      return result;
    default:
      return result;
  }
}

async function handleInboundDocument(
  result: Extract<TransportWebhookResult, { kind: "document" }>,
  transport: EinvoiceTransport,
): Promise<void> {
  if (Buffer.byteLength(result.xml, "utf-8") > MAX_INBOUND_BYTES) {
    throw new TransportWebhookSizeError("Inbound document exceeds the 10 MB cap");
  }
  const source = transport.id === "qonto-fr" ? "qonto" : "peppol";
  const { id } = await importEinvoiceFile({
    fileName: result.fileName,
    contentType: result.contentType,
    bytes: Buffer.from(result.xml, "utf-8"),
    source,
    transportId: transport.id,
    providerMessageId: result.providerMessageId,
    senderScheme: result.sender.scheme,
    senderId: result.sender.value,
  });
  logActivity({
    action: "create",
    resource_type: "einvoice_inbox",
    resource_id: id,
    metadata: { source, provider_message_id: result.providerMessageId },
  });
  void dispatchEvent("einvoice.received", {
    inbox_id: id,
    provider_message_id: result.providerMessageId,
    sender_scheme: result.sender.scheme,
    sender_id: result.sender.value,
  });
}

function handleInboundStatus(result: Extract<TransportWebhookResult, { kind: "status" }>): void {
  const db = getDb();
  const row = db
    .query(
      "SELECT id, invoice_id, status FROM einvoice_transmissions WHERE provider_message_id = ?",
    )
    .get(result.providerMessageId) as { id: string; invoice_id: string; status: string } | null;

  // Unknown ids are logged and ignored, not errored: the provider may retry a
  // callback for a document we never sent, or the row was cleaned up.
  if (!row) {
    logger.warn(
      { providerMessageId: result.providerMessageId, status: result.status },
      "Ignoring status webhook for unknown transmission",
    );
    return;
  }

  if (result.status === "delivered" || result.status === "rejected") {
    db.query(
      `UPDATE einvoice_transmissions SET status = ?, status_detail = ?, delivered_at = datetime('now'),
              next_attempt_at = NULL, updated_at = datetime('now') WHERE id = ?`,
    ).run(result.status, result.detail, row.id);
    logActivity({
      action: result.status === "delivered" ? "transmission_delivered" : "transmission_rejected",
      resource_type: "invoice",
      resource_id: row.invoice_id,
      metadata: { transmission_id: row.id, detail: result.detail },
    });
    const payload = {
      invoice_id: row.invoice_id,
      transmission_id: row.id,
      detail: result.detail,
    };
    void dispatchEvent(
      result.status === "delivered" ? "einvoice.delivered" : "einvoice.rejected",
      payload,
    );
  }
}

function handleInboundParticipant(
  result: Extract<TransportWebhookResult, { kind: "participant" }>,
): void {
  const db = getDb();
  const row = db
    .query("SELECT id FROM peppol_participants WHERE provider_ref = ?")
    .get(result.providerRef) as { id: string } | null;
  if (!row) {
    logger.warn(
      { providerRef: result.providerRef },
      "Ignoring participant webhook for unknown registration",
    );
    return;
  }
  const registeredAt = result.status === "active" ? "datetime('now')" : "NULL";
  db.query(
    `UPDATE peppol_participants SET status = ?, status_detail = ?,
            registered_at = COALESCE(registered_at, ${registeredAt}),
            updated_at = datetime('now') WHERE id = ?`,
  ).run(result.status, result.detail, row.id);
}

// ---------- auto-send hook (§9.1.2) ----------

/**
 * Fire-and-forget auto-transmit for `peppol_auto_send`. Must never throw —
 * a transport failure must not fail the invoice send that triggered it.
 */
export function maybeAutoTransmit(invoiceId: string): void {
  try {
    if (getSetting("peppol_auto_send") !== "true") return;
    void enqueueTransmission(invoiceId).then((result) => {
      if (!result.ok) {
        logger.info(
          { invoiceId, code: result.code },
          "Auto PEPPOL transmit skipped (precondition not met)",
        );
      }
    });
  } catch (err) {
    logger.warn({ err, invoiceId }, "Auto PEPPOL transmit failed");
  }
}

/** Domain error with a stable code, used by the routes to map to HTTP. */
export class TransportError extends Error {
  constructor(
    readonly status: 409 | 502,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TransportError";
  }
}
