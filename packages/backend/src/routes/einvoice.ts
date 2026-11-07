import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../database/connection";
import { requirePermission } from "../middleware/auth";
import { logActivity } from "../services/activity.service";
import {
  deleteInboxItem,
  getInboxItem,
  getInboxRaw,
  type InboxStatus,
  importEinvoiceFile,
  linkInboxToCustomer,
  listInboxItems,
  updateInboxStatus,
} from "../services/einvoice-inbox.service";
import {
  cancelTransmission,
  deregisterParticipant,
  enqueueTransmission,
  getCurrentParticipant,
  listTransmissions,
  lookupParticipant,
  refreshParticipant,
  registerReceiver,
  retryTransmission,
  TransportError,
  TransportWebhookSizeError,
} from "../services/einvoice-transport.service";
import { getFranceTransport, listTransports } from "../services/einvoice-transports/registry";

// E-invoice inbox: receive, list, inspect and archive incoming
// XRechnung/ZUGFeRD documents (mandatory in Germany since 1 Jan 2025).
// Plus the PEPPOL transport layer: send, transmissions, participant
// registration and network lookup.

const einvoices = new Hono();

einvoices.get("/inbox", requirePermission("invoices", "read"), (c) => {
  const status = c.req.query("status") as InboxStatus | undefined;
  if (status && !["inbox", "processed", "archived"].includes(status)) {
    return c.json({ success: false, error: "Invalid status filter" }, 400);
  }
  return c.json({ success: true, data: listInboxItems(status) });
});

einvoices.post("/inbox/import", requirePermission("invoices", "create"), async (c) => {
  const body = await c.req.parseBody();
  const file = body.file;
  if (!file || typeof file === "string") {
    return c.json({ success: false, error: "file is required (multipart upload)" }, 400);
  }
  const name = (file as File).name || "einvoice.xml";
  const type = (file as File).type || "application/xml";

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await (file as File).arrayBuffer());
  } catch {
    return c.json({ success: false, error: "Could not read uploaded file" }, 400);
  }
  if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024) {
    return c.json({ success: false, error: "File must be between 1 byte and 20 MB" }, 400);
  }

  const { id, duplicate } = await importEinvoiceFile({ fileName: name, contentType: type, bytes });
  logActivity({
    action: "create",
    resource_type: "einvoice_inbox",
    resource_id: id,
    metadata: { fileName: name, duplicate },
  });
  return c.json({ success: true, data: { id, duplicate } }, duplicate ? 200 : 201);
});

einvoices.get("/inbox/:id", requirePermission("invoices", "read"), (c) => {
  const item = getInboxItem(c.req.param("id"));
  if (!item) return c.json({ success: false, error: "Inbox item not found" }, 404);
  return c.json({ success: true, data: item });
});

einvoices.get("/inbox/:id/raw", requirePermission("invoices", "read"), (c) => {
  const raw = getInboxRaw(c.req.param("id"));
  if (!raw) return c.json({ success: false, error: "Inbox item not found" }, 404);
  c.header("Content-Type", "application/xml; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${raw.fileName}"`);
  return c.body(new Uint8Array(raw.bytes));
});

const linkSchema = z.object({
  customer_id: z.string().min(1).nullable(),
});

einvoices.post("/inbox/:id/link", requirePermission("invoices", "update"), async (c) => {
  const body = linkSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ success: false, error: "customer_id required" }, 400);
  const item = getInboxItem(c.req.param("id"));
  if (!item) return c.json({ success: false, error: "Inbox item not found" }, 404);
  if (body.data.customer_id) {
    const exists = getDb()
      .query("SELECT id FROM customers WHERE id = ? AND deleted_at IS NULL")
      .get(body.data.customer_id);
    if (!exists) return c.json({ success: false, error: "Customer not found" }, 404);
  }
  linkInboxToCustomer(c.req.param("id"), body.data.customer_id);
  logActivity({
    action: "update",
    resource_type: "einvoice_inbox",
    resource_id: item.id,
    metadata: { customer_id: body.data.customer_id },
  });
  return c.json({ success: true });
});

einvoices.post("/inbox/:id/status", requirePermission("invoices", "update"), async (c) => {
  const body = z
    .object({ status: z.enum(["inbox", "processed", "archived"]) })
    .safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ success: false, error: "status required" }, 400);
  if (!updateInboxStatus(c.req.param("id"), body.data.status)) {
    return c.json({ success: false, error: "Inbox item not found" }, 404);
  }
  return c.json({ success: true });
});

einvoices.delete("/inbox/:id", requirePermission("invoices", "delete"), (c) => {
  if (!deleteInboxItem(c.req.param("id"))) {
    return c.json({ success: false, error: "Inbox item not found" }, 404);
  }
  return c.json({ success: true });
});

// ---------- PEPPOL transport ----------

// Available drivers, without credentials (the UI renders the picker from this).
einvoices.get("/peppol/transports", requirePermission("settings", "read"), (c) => {
  const transports = listTransports().map((t) => ({
    id: t.id,
    label: t.label,
    networks: t.networks,
    configured: t.isConfigured(),
  }));
  return c.json({ success: true, data: transports });
});

// Our registration state.
einvoices.get("/peppol/participant", requirePermission("settings", "read"), (c) => {
  return c.json({ success: true, data: getCurrentParticipant() });
});

const registerSchema = z.object({
  scheme: z.string().min(2).max(20),
  identifier: z.string().min(1).max(100),
  legal_name: z.string().min(1).max(200),
  country_code: z.string().length(2),
  contact_email: z.string().email().max(200),
});

// Start receiver registration (check → register, never a takeover).
einvoices.post("/peppol/participant", requirePermission("settings", "update"), async (c) => {
  const parsed = registerSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ success: false, error: "Invalid registration payload" }, 400);
  }
  try {
    const state = await registerReceiver({
      participant: { scheme: parsed.data.scheme, value: parsed.data.identifier },
      legalName: parsed.data.legal_name,
      countryCode: parsed.data.country_code,
      contactEmail: parsed.data.contact_email,
    });
    logActivity({
      user_id: c.get("userId"),
      user_name: c.get("user")?.username,
      action: "peppol_registration",
      resource_type: "peppol_participant",
      metadata: {
        scheme: parsed.data.scheme,
        identifier: parsed.data.identifier,
        status: state.status,
      },
    });
    return c.json({ success: true, data: state });
  } catch (err) {
    return transportError(c, err);
  }
});

// Poll the provider for the latest registration state.
einvoices.post(
  "/peppol/participant/refresh",
  requirePermission("settings", "update"),
  async (c) => {
    try {
      const state = await refreshParticipant();
      if (!state) {
        return c.json({ success: false, error: "No participant registration found" }, 404);
      }
      return c.json({ success: true, data: state });
    } catch (err) {
      return transportError(c, err);
    }
  },
);

einvoices.delete("/peppol/participant", requirePermission("settings", "update"), async (c) => {
  try {
    if (!(await deregisterParticipant())) {
      return c.json({ success: false, error: "No participant registration found" }, 404);
    }
    return c.json({ success: true });
  } catch (err) {
    return transportError(c, err);
  }
});

const lookupSchema = z.object({
  scheme: z.string().min(2).max(20),
  identifier: z.string().min(1).max(100),
  customer_id: z.string().optional(),
});

// Check any participant on the network (customer form "Check PEPPOL" button).
einvoices.post("/peppol/lookup", requirePermission("customers", "update"), async (c) => {
  const parsed = lookupSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ success: false, error: "scheme and identifier are required" }, 400);
  }
  try {
    const capability = await lookupParticipant(
      { scheme: parsed.data.scheme, value: parsed.data.identifier },
      parsed.data.customer_id,
    );
    return c.json({ success: true, data: capability });
  } catch (err) {
    return transportError(c, err);
  }
});

const franceLookupSchema = z.object({
  siren: z.string().regex(/^\d{9}$/, "SIREN must be 9 digits"),
  customer_id: z.string().optional(),
});

// Check a French recipient on the Annuaire (through the active France transport).
einvoices.post("/france/lookup", requirePermission("customers", "update"), async (c) => {
  const parsed = franceLookupSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ success: false, error: "siren (9 digits) is required" }, 400);
  }
  const transport = getFranceTransport();
  if (!transport) {
    return c.json(
      {
        success: false,
        error: "France e-invoicing is not configured or enabled.",
        code: "france_not_configured",
      },
      409,
    );
  }
  try {
    const capability = await transport.lookupParticipant({
      scheme: "0009",
      value: parsed.data.siren,
    });
    if (parsed.data.customer_id) {
      getDb()
        .query(
          "UPDATE customers SET france_checked_at = datetime('now'), france_reachable = ? WHERE id = ?",
        )
        .run(capability.exists ? 1 : 0, parsed.data.customer_id);
    }
    return c.json({ success: true, data: capability });
  } catch (err) {
    return transportError(c, err);
  }
});

// Send an invoice (or credit note) over PEPPOL.
einvoices.post("/:invoiceId/transmit", requirePermission("invoices", "publish"), async (c) => {
  const result = await enqueueTransmission(c.req.param("invoiceId") ?? "");
  if (!result.ok) {
    return c.json(
      { success: false, error: result.error, code: result.code, issues: result.issues },
      result.status,
    );
  }
  return c.json({ success: true, data: { transmission_id: result.transmissionId } }, 201);
});

// Transmission history for an invoice, with per-attempt audit rows.
einvoices.get("/:invoiceId/transmissions", requirePermission("invoices", "read"), (c) => {
  const { transmissions, attempts } = listTransmissions(c.req.param("invoiceId") ?? "");
  return c.json({ success: true, data: { transmissions, attempts } });
});

einvoices.post("/transmissions/:id/retry", requirePermission("invoices", "publish"), (c) => {
  if (!retryTransmission(c.req.param("id") ?? "")) {
    return c.json({ success: false, error: "Transmission not found or not failed" }, 404);
  }
  return c.json({ success: true });
});

einvoices.post("/transmissions/:id/cancel", requirePermission("invoices", "publish"), (c) => {
  if (!cancelTransmission(c.req.param("id") ?? "")) {
    return c.json({ success: false, error: "Transmission not found or no longer queued" }, 404);
  }
  return c.json({ success: true });
});

function transportError(c: Context, err: unknown): Response {
  if (err instanceof TransportError) {
    return c.json({ success: false, error: err.message, code: err.code }, err.status);
  }
  if (err instanceof TransportWebhookSizeError) {
    return c.json({ success: false, error: "Payload too large", code: "PAYLOAD_TOO_LARGE" }, 413);
  }
  return c.json({ success: false, error: "Transport error", code: "INTERNAL_ERROR" }, 502);
}

export { einvoices };
