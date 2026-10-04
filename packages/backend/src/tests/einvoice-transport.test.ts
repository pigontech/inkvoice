import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import {
  cancelTransmission,
  enqueueTransmission,
  getCurrentParticipant,
  listTransmissions,
  processTransportQueue,
  registerReceiver,
  retryTransmission,
  TransportError,
  TransportWebhookSizeError,
} from "../services/einvoice-transport.service";
import {
  fakeTransport,
  fakeTransportState,
  resetFakeTransport,
} from "../services/einvoice-transports/fake.transport";
import { peppolShTransport } from "../services/einvoice-transports/peppol-sh.transport";
import { getActiveTransport, listTransports } from "../services/einvoice-transports/registry";
import {
  type SendContext,
  TransportHttpError,
  type TransportWebhookResult,
} from "../services/einvoice-transports/types";
import { getSetting, updateSettings } from "../services/settings.service";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-einvoice-transport.db";
let app: Hono;
let token: string;

// A transmission whose invoice/customer data make it enqueueable.
let customerId: string;
let invoiceId: string;

function authed(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    ...((opts.headers as Record<string, string>) || {}),
    Authorization: `Bearer ${token}`,
  };
  if (opts.method && opts.method !== "GET") headers["Content-Type"] = "application/json";
  return app.request(new Request(`http://localhost${path}`, { ...opts, headers }));
}

async function makeEnqueueableInvoice() {
  const cust = await authed("/api/v1/customers", {
    method: "POST",
    body: JSON.stringify({
      name: "Buyer BV",
      email: "buyer@example.com",
      country: "BE",
      address_line1: "Kerkstraat 1",
      city: "Antwerpen",
      postal_code: "2000",
      einvoice_receiver_scheme: "0208",
      einvoice_receiver_id: "0456123456",
    }),
  });
  customerId = ((await cust.json()) as any).data.id;
  const inv = await authed("/api/v1/invoices", {
    method: "POST",
    body: JSON.stringify({
      customer_id: customerId,
      issue_date: "2026-08-01",
      currency: "EUR",
      items: [{ description: "Consulting", quantity: 1, unit_price: 500 }],
    }),
  });
  invoiceId = ((await inv.json()) as any).data.id;
}

// Minimal structured invoice payload for direct driver calls.
function sendCtx(number: string): SendContext {
  return {
    transmissionId: "tx-42",
    sender: { scheme: "0208", value: "A" },
    receiver: { scheme: "0208", value: "B" },
    documentType: "invoice" as const,
    xml: "<Invoice/>",
    hash: "h",
    documentNumber: number,
    data: {
      invoice_number: number,
      issue_date: "2026-08-01",
      due_date: null,
      currency: "EUR",
      locale: null,
      type: "invoice" as const,
      notes: null,
      payment_terms: null,
      subtotal: 500,
      tax_total: 105,
      discount_amount: 0,
      total: 605,
      supplier: {
        name: "Seller BV",
        email: null,
        phone: null,
        address: null,
        street: "Hoofdstraat 5",
        city: "Brussel",
        postal_code: "1000",
        country: "BE",
        tax_id: "BE0123456789",
        tax_number: null,
        bank_details: null,
        iban: null,
        bic: null,
        account_holder: null,
        contact_name: null,
        peppol_endpoint_id: null,
        peppol_scheme_id: null,
      },
      customer: {
        name: "Buyer BV",
        email: null,
        phone: null,
        address_line1: "Kerkstraat 1",
        address_line2: null,
        city: "Antwerpen",
        state: null,
        postal_code: "2000",
        country: "BE",
        tax_id: "BE0123456789",
        tax_number: null,
        einvoice_format: null,
        leitweg_id: null,
        einvoice_receiver_id: null,
        einvoice_receiver_scheme: null,
        siren: null,
        siret: null,
      },
      items: [
        {
          id: "i1",
          description: "Consulting",
          quantity: 1,
          unit_price: 500,
          unit: "piece",
          line_total: 500,
          tax_rate: 21,
          tax_amount: 105,
          tax_category_code: "S",
        },
      ],
      tax_breakdown: [
        { tax_name: "VAT", tax_rate: 21, category_code: "S", taxable_amount: 500, tax_amount: 105 },
      ],
    },
  };
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "testpass123456";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  process.env.RATE_LIMIT_ENABLED = "false";
  resetEnvCache();

  initDatabase();
  runMigrations();
  await seed();
  app = createApp();

  const res = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "testpass123456" }),
  });
  token = ((await res.json()) as any).data.token;

  // Company profile for a valid PEPPOL emission (BE company).
  await authed("/api/v1/settings", {
    method: "PUT",
    body: JSON.stringify({
      company_name: "Seller BV",
      company_tax_id: "BE0123456789",
      company_country: "BE",
      company_street: "Hoofdstraat 5",
      company_city: "Brussel",
      company_postal_code: "1000",
      einvoice_enabled: "true",
      peppol_enabled: "true",
      peppol_transport: "fake",
      peppol_sender_scheme: "0208",
      peppol_sender_id: "0123456789",
      peppol_auto_send: "false",
      peppol_environment: "test",
    }),
  });

  await makeEnqueueableInvoice();
  resetFakeTransport();
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
});

function row(transmissionId: string) {
  return getDb()
    .query("SELECT * FROM einvoice_transmissions WHERE id = ?")
    .get(transmissionId) as Record<string, unknown>;
}

function statusOf(transmissionId: string): string {
  return String(row(transmissionId).status);
}

/** Wipe transmissions so a worker tick only ever sees the rows this test made. */
function clearTransmissions() {
  getDb().query("DELETE FROM einvoice_transmissions").run();
  getDb().query("DELETE FROM einvoice_transmission_attempts").run();
}

describe("registry", () => {
  test("unknown transport id resolves to null, not a throw", () => {
    updateSettings({ peppol_transport: "does-not-exist" });
    expect(getActiveTransport()).toBeNull();
    updateSettings({ peppol_transport: "fake" });
  });

  test("honours peppol_enabled and isConfigured", () => {
    updateSettings({ peppol_enabled: "false" });
    expect(getActiveTransport()).toBeNull();
    updateSettings({ peppol_enabled: "true" });
    expect(getActiveTransport()?.id).toBe("fake");
    expect(listTransports().map((t) => t.id)).toContain("peppol-sh");
    expect(listTransports().map((t) => t.id)).toContain("fake");
  });

  test("fake transport records sends and returns scripted receipts", async () => {
    resetFakeTransport();
    clearTransmissions();
    fakeTransportState.nextSendReceipt = { providerMessageId: "msg-x", status: "sent" };
    const receipt = await fakeTransport.send({
      transmissionId: "t-1",
      sender: { scheme: "0208", value: "A" },
      receiver: { scheme: "0208", value: "B" },
      documentType: "invoice",
      xml: "<Invoice/>",
      hash: "abc",
      documentNumber: "INV-1",
      data: sendCtx("INV-1").data,
    });
    expect(receipt.providerMessageId).toBe("msg-x");
    expect(fakeTransportState.sent[0].transmissionId).toBe("t-1");
  });
});

describe("enqueue preconditions (§9.2)", () => {
  test("each precondition returns its distinct error and creates no row", async () => {
    resetFakeTransport();
    clearTransmissions();
    const before = getDb().query("SELECT COUNT(*) as c FROM einvoice_transmissions").get() as {
      c: number;
    };

    // Missing receiver id.
    const noReceiver = await authed("/api/v1/customers", {
      method: "POST",
      body: JSON.stringify({ name: "No Receiver", country: "DE", address_line1: "X", city: "Y" }),
    });
    const custNoRecv = ((await noReceiver.json()) as any).data.id;
    const invNoRecv = await authed("/api/v1/invoices", {
      method: "POST",
      body: JSON.stringify({
        customer_id: custNoRecv,
        issue_date: "2026-08-01",
        items: [{ description: "x", quantity: 1, unit_price: 10 }],
      }),
    });
    const invNoRecvId = ((await invNoRecv.json()) as any).data.id;

    let res = await authed(`/api/v1/einvoices/${invNoRecvId}/transmit`, { method: "POST" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).code).toBe("receiver_id_missing");

    // Missing sender identity.
    const originalSender = getSetting("peppol_sender_id");
    updateSettings({ peppol_sender_id: "" });
    res = await authed(`/api/v1/einvoices/${invoiceId}/transmit`, { method: "POST" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).code).toBe("sender_id_missing");
    updateSettings({ peppol_sender_id: originalSender ?? "0123456789" });

    // Disabled transport.
    updateSettings({ peppol_enabled: "false" });
    res = await authed(`/api/v1/einvoices/${invoiceId}/transmit`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).code).toBe("peppol_not_configured");
    updateSettings({ peppol_enabled: "true" });

    // Unreachable receiver.
    fakeTransportState.capability = {
      exists: false,
      documentTypes: [],
      accessPointName: null,
      servedElsewhere: false,
    };
    res = await authed(`/api/v1/einvoices/${invoiceId}/transmit`, { method: "POST" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).code).toBe("receiver_unreachable");
    fakeTransportState.capability = {
      exists: true,
      documentTypes: ["invoice", "credit-note"],
      accessPointName: null,
      servedElsewhere: false,
    };

    const after = getDb().query("SELECT COUNT(*) as c FROM einvoice_transmissions").get() as {
      c: number;
    };
    expect(after.c).toBe(before.c);
  });

  test("validation errors block transmission", async () => {
    // A customer with receiver id but no address → buyer_address error.
    const cust = await authed("/api/v1/customers", {
      method: "POST",
      body: JSON.stringify({
        name: "No Address",
        country: "BE",
        einvoice_receiver_scheme: "0208",
        einvoice_receiver_id: "0456123456",
      }),
    });
    const custId = ((await cust.json()) as any).data.id;
    const inv = await authed("/api/v1/invoices", {
      method: "POST",
      body: JSON.stringify({
        customer_id: custId,
        issue_date: "2026-08-01",
        items: [{ description: "x", quantity: 1, unit_price: 10 }],
      }),
    });
    const invId = ((await inv.json()) as any).data.id;

    const res = await authed(`/api/v1/einvoices/${invId}/transmit`, { method: "POST" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as any;
    expect(body.code).toBe("validation_failed");
    expect(body.issues.some((i: any) => i.severity === "error")).toBe(true);
  });
});

describe("outbound flow (§9)", () => {
  test("happy path: enqueue → tick → sent → status webhook → delivered", async () => {
    resetFakeTransport();
    clearTransmissions();
    const res = await authed(`/api/v1/einvoices/${invoiceId}/transmit`, { method: "POST" });
    expect(res.status).toBe(201);
    const { transmission_id } = ((await res.json()) as any).data;

    expect(statusOf(transmission_id)).toBe("queued");
    expect(fakeTransportState.sent).toHaveLength(0);

    await processTransportQueue();
    expect(statusOf(transmission_id)).toBe("sent");
    expect(fakeTransportState.sent).toHaveLength(1);
    expect(fakeTransportState.sent[0].transmissionId).toBe(transmission_id);
    expect(fakeTransportState.sent[0].documentType).toBe("invoice");
    expect(fakeTransportState.sent[0].xml).toContain("urn:oasis:names:specification:ubl");
    expect(fakeTransportState.sent[0].sender.value).toBe("0123456789");
    expect(fakeTransportState.sent[0].receiver.value).toBe("0456123456");

    const afterTick = row(transmission_id);
    expect(afterTick.sent_at).not.toBeNull();
    expect(afterTick.provider_message_id).toBe(`fake-msg-${transmission_id}`);

    // A send already in flight is refused.
    const dup = await authed(`/api/v1/einvoices/${invoiceId}/transmit`, { method: "POST" });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as any).code).toBe("already_in_flight");

    // Delivery arrives via status webhook.
    fakeTransportState.nextWebhookResult = {
      kind: "status",
      eventId: "ev-delivered-1",
      providerMessageId: `fake-msg-${transmission_id}`,
      status: "delivered",
      detail: null,
    };
    const wh = await app.request("/api/v1/webhooks/peppol", { method: "POST", body: "{}" });
    expect(wh.status).toBe(200);
    expect(statusOf(transmission_id)).toBe("delivered");
    expect(row(transmission_id).delivered_at).not.toBeNull();

    // A delivered transmission can be re-transmitted as a new document.
    const second = await authed(`/api/v1/einvoices/${invoiceId}/transmit`, { method: "POST" });
    expect(second.status).toBe(201);
    const secondId = ((await second.json()) as any).data.transmission_id;
    expect(secondId).not.toBe(transmission_id);
  });

  test("crash recovery: a row left in 'sending' is retried with the same transmissionId", async () => {
    resetFakeTransport();
    clearTransmissions();
    const res = await authed(`/api/v1/einvoices/${invoiceId}/transmit`, { method: "POST" });
    const transmissionId = ((await res.json()) as any).data.transmission_id;
    getDb()
      .query("UPDATE einvoice_transmissions SET status = 'sending' WHERE id = ?")
      .run(transmissionId);

    await processTransportQueue();
    expect(statusOf(transmissionId)).toBe("sent");
    expect(fakeTransportState.sent[0].transmissionId).toBe(transmissionId);
  });

  test("negative MLR moves to rejected and never retries", async () => {
    resetFakeTransport();
    clearTransmissions();
    const res = await authed(`/api/v1/einvoices/${invoiceId}/transmit`, { method: "POST" });
    const transmissionId = ((await res.json()) as any).data.transmission_id;
    await processTransportQueue();
    expect(statusOf(transmissionId)).toBe("sent");

    fakeTransportState.nextWebhookResult = {
      kind: "status",
      eventId: "ev-rejected-1",
      providerMessageId: `fake-msg-${transmissionId}`,
      status: "rejected",
      detail: "Duplicate invoice",
    };
    const wh = await app.request("/api/v1/webhooks/peppol", { method: "POST", body: "{}" });
    expect(wh.status).toBe(200);
    expect(statusOf(transmissionId)).toBe("rejected");
    expect(row(transmissionId).next_attempt_at).toBeNull();

    // Nothing left to pick up.
    await processTransportQueue();
    expect(fakeTransportState.sent.length).toBeLessThanOrEqual(1);
  });

  test("error classification: 429/408 retry, 400/422 are permanent", async () => {
    resetFakeTransport();
    clearTransmissions();

    // Permanent 400 → failed on the first attempt.
    fakeTransportState.nextSendError = new TransportHttpError("Bad document", 400, "{}");
    const permRes = await authed(`/api/v1/einvoices/${invoiceId}/transmit`, { method: "POST" });
    const permId = ((await permRes.json()) as any).data.transmission_id;
    await processTransportQueue();
    expect(statusOf(permId)).toBe("failed");
    expect(row(permId).next_attempt_at).toBeNull();

    // Throttled 429 → queued with a backoff time.
    resetFakeTransport();
    clearTransmissions();
    fakeTransportState.nextSendError = new TransportHttpError("Slow down", 429, "{}");
    const retryRes = await authed(`/api/v1/einvoices/${invoiceId}/transmit`, { method: "POST" });
    const retryId = ((await retryRes.json()) as any).data.transmission_id;
    await processTransportQueue();
    expect(statusOf(retryId)).toBe("queued");
    expect(row(retryId).attempt_count).toBe(1);
    const backoff = String(row(retryId).next_attempt_at);
    expect(backoff).not.toBeNull();

    // Network failure (no status code) is retryable too.
    resetFakeTransport();
    clearTransmissions();
    fakeTransportState.nextSendError = new TransportHttpError("ECONNRESET", null, null);
    const netRes = await authed(`/api/v1/einvoices/${invoiceId}/transmit`, { method: "POST" });
    const netId = ((await netRes.json()) as any).data.transmission_id;
    await processTransportQueue();
    expect(statusOf(netId)).toBe("queued");
  });

  test("backoff schedule: attempt N delays per table; attempt 7 goes terminal", async () => {
    resetFakeTransport();
    clearTransmissions();
    fakeTransportState.nextSendError = new TransportHttpError("Down", 500, "{}");
    const res = await authed(`/api/v1/einvoices/${invoiceId}/transmit`, { method: "POST" });
    const transmissionId = ((await res.json()) as any).data.transmission_id;

    const expectedMinutes = [1, 5, 15, 60, 360, 1440];
    for (let i = 0; i < 6; i++) {
      await processTransportQueue();
      const r = row(transmissionId);
      expect(String(r.status)).toBe("queued");
      expect(Number(r.attempt_count)).toBe(i + 1);
      const next = new Date(`${String(r.next_attempt_at).replace(" ", "T")}Z`);
      const expected = Date.now() + expectedMinutes[i] * 60_000;
      expect(Math.abs(next.getTime() - expected)).toBeLessThan(120_000);
      // Force the next attempt to be due now (delays are real minutes).
      getDb()
        .query("UPDATE einvoice_transmissions SET next_attempt_at = NULL WHERE id = ?")
        .run(transmissionId);
    }
    // Attempt 7 exhausts retries → terminal failed.
    await processTransportQueue();
    expect(statusOf(transmissionId)).toBe("failed");
    expect(Number(row(transmissionId).attempt_count)).toBe(7);
    expect(row(transmissionId).next_attempt_at).toBeNull();

    const attempts = listTransmissions(invoiceId).attempts[transmissionId];
    expect(attempts).toHaveLength(7);
    expect(attempts[0].status_code).toBe(500);

    // Retry resets the failed row to queued.
    expect(retryTransmission(transmissionId)).toBe(true);
    expect(statusOf(transmissionId)).toBe("queued");
    // And cancel deletes a queued row.
    expect(cancelTransmission(transmissionId)).toBe(true);
  });

  test("transmissions listing includes attempts", async () => {
    resetFakeTransport();
    clearTransmissions();
    await authed(`/api/v1/einvoices/${invoiceId}/transmit`, { method: "POST" });
    await processTransportQueue();
    const res = await authed(`/api/v1/einvoices/${invoiceId}/transmissions`);
    expect(res.status).toBe(200);
    const { transmissions } = ((await res.json()) as any).data;
    expect(transmissions.length).toBeGreaterThan(0);
    expect(transmissions[0].invoice_number).toBeTruthy();
  });
});

describe("inbound webhooks (§11)", () => {
  test("a document event creates exactly one inbox row with source=peppol", async () => {
    resetFakeTransport();
    clearTransmissions();
    const xml = `<?xml version="1.0"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <cbc:ID xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">IN-4711</cbc:ID>
  <cbc:IssueDate xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">2026-08-10</cbc:IssueDate>
  <cbc:DocumentCurrencyCode xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">EUR</cbc:DocumentCurrencyCode>
  <cac:LegalMonetaryTotal xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"><cbc:TaxInclusiveAmount currencyID="EUR">100.00</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal>
</Invoice>`;

    fakeTransportState.nextWebhookResult = {
      kind: "document",
      eventId: "ev-doc-1",
      providerMessageId: "incoming-1",
      sender: { scheme: "0208", value: "0987654321" },
      fileName: "invoice-4711.xml",
      contentType: "application/xml",
      xml,
    };
    const res = await app.request("/api/v1/webhooks/peppol", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);

    const inbox = getDb()
      .query("SELECT * FROM einvoice_inbox WHERE provider_message_id = 'incoming-1'")
      .all() as Record<string, unknown>[];
    expect(inbox).toHaveLength(1);
    expect(inbox[0].source).toBe("peppol");
    expect(inbox[0].transport_id).toBe("fake");
    expect(inbox[0].sender_scheme).toBe("0208");
    expect(inbox[0].sender_id).toBe("0987654321");

    // Replay with the same event id is a no-op 200.
    fakeTransportState.nextWebhookResult = {
      kind: "document",
      eventId: "ev-doc-1",
      providerMessageId: "incoming-1",
      sender: { scheme: "0208", value: "0987654321" },
      fileName: "invoice-4711.xml",
      contentType: "application/xml",
      xml,
    };
    const replay = await app.request("/api/v1/webhooks/peppol", { method: "POST", body: "{}" });
    expect(replay.status).toBe(200);
    const afterReplay = getDb()
      .query("SELECT COUNT(*) as c FROM einvoice_inbox WHERE provider_message_id = 'incoming-1'")
      .get() as { c: number };
    expect(afterReplay.c).toBe(1);
  });

  test("a 12 MB inbound payload is refused before insert", async () => {
    resetFakeTransport();
    clearTransmissions();
    fakeTransportState.nextWebhookResult = {
      kind: "document",
      eventId: "ev-doc-big",
      providerMessageId: "incoming-big",
      sender: { scheme: "0208", value: "0987654321" },
      fileName: "big.xml",
      contentType: "application/xml",
      xml: `<Invoice>${"x".repeat(12 * 1024 * 1024)}</Invoice>`,
    };
    const res = await app.request("/api/v1/webhooks/peppol", { method: "POST", body: "{}" });
    expect(res.status).toBe(413);
    const rows = getDb()
      .query("SELECT COUNT(*) as c FROM einvoice_inbox WHERE provider_message_id = 'incoming-big'")
      .get() as { c: number };
    expect(rows.c).toBe(0);
  });

  test("status webhook for an unknown transmission is ignored, not errored", async () => {
    resetFakeTransport();
    clearTransmissions();
    fakeTransportState.nextWebhookResult = {
      kind: "status",
      eventId: "ev-unknown",
      providerMessageId: "never-sent",
      status: "delivered",
      detail: null,
    };
    const res = await app.request("/api/v1/webhooks/peppol", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
  });

  test("participant webhook updates the registration row", async () => {
    resetFakeTransport();
    clearTransmissions();
    const state = await registerReceiver({
      participant: { scheme: "0208", value: "0123456789" },
      legalName: "Seller BV",
      countryCode: "BE",
      contactEmail: "billing@example.com",
    });
    expect(state.status).toBe("kyc_pending");

    fakeTransportState.nextWebhookResult = {
      kind: "participant",
      eventId: "ev-part-1",
      providerRef: "fake-reg-1",
      status: "active",
      detail: null,
    };
    const res = await app.request("/api/v1/webhooks/peppol", { method: "POST", body: "{}" });
    expect(res.status).toBe(200);

    const current = getCurrentParticipant();
    expect(current?.status).toBe("active");
    expect(current?.registered_at).not.toBeNull();
  });

  test("unverified webhook (no active transport configured for parsing) → 401", async () => {
    updateSettings({ peppol_enabled: "false" });
    const res = await app.request("/api/v1/webhooks/peppol", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    updateSettings({ peppol_enabled: "true" });
  });

  test("simulated document.received webhook lands in the inbox through the real peppol.sh driver", async () => {
    resetFakeTransport();
    clearTransmissions();
    // Save/restore (not delete): bun hoists every describe's beforeAll ahead
    // of the first test, so the "peppol.sh driver" block's env may already be
    // set when this test runs — deleting would break its later tests.
    const prevEnv = {
      key: process.env.PEPPOL_SH_API_KEY,
      secret: process.env.PEPPOL_SH_WEBHOOK_SECRET,
      base: process.env.PEPPOL_SH_BASE_URL,
    };
    const restorePeppolEnv = () => {
      for (const [k, v] of [
        ["PEPPOL_SH_API_KEY", prevEnv.key],
        ["PEPPOL_SH_WEBHOOK_SECRET", prevEnv.secret],
        ["PEPPOL_SH_BASE_URL", prevEnv.base],
      ] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetEnvCache();
    };
    process.env.PEPPOL_SH_API_KEY = "test-key";
    process.env.PEPPOL_SH_WEBHOOK_SECRET = "webhook-secret";
    process.env.PEPPOL_SH_BASE_URL = "https://api.peppol.sh";
    resetEnvCache();
    updateSettings({ peppol_transport: "peppol-sh" });
    try {
      // Unique fixture: the inbox dedupes on raw hash, so this must differ
      // from every XML the fake-transport tests already imported.
      const xml = `<?xml version="1.0"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <cbc:ID xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">IN-RECV-7777</cbc:ID>
  <cbc:IssueDate xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">2026-08-11</cbc:IssueDate>
  <cbc:DocumentCurrencyCode xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">EUR</cbc:DocumentCurrencyCode>
  <cac:LegalMonetaryTotal xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"><cbc:TaxInclusiveAmount currencyID="EUR">1234.50</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal>
</Invoice>`;
      const body = JSON.stringify({
        type: "document.received",
        document: {
          id: "doc_recv_1",
          sender: { scheme: "0208", value: "0987654321" },
          file_name: "IN-RECV-7777.xml",
          content_type: "application/xml",
          xml,
        },
      });
      const ts = Math.floor(Date.now() / 1000);
      const signature = createHmac("sha256", "webhook-secret").update(body).digest("hex");

      // End-to-end: signed HTTP request → driver HMAC verify + parse → inbox insert.
      const res = await app.request("/api/v1/webhooks/peppol", {
        method: "POST",
        headers: {
          "x-peppol-sh-signature": signature,
          "x-peppol-sh-timestamp": String(ts),
          "x-peppol-sh-event-id": "ev-oss-recv-1",
          "Content-Type": "application/json",
        },
        body,
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { kind: string }).kind).toBe("document");

      const inbox = getDb()
        .query("SELECT * FROM einvoice_inbox WHERE provider_message_id = 'doc_recv_1'")
        .all() as Record<string, unknown>[];
      expect(inbox).toHaveLength(1);
      expect(inbox[0].source).toBe("peppol");
      expect(inbox[0].transport_id).toBe("peppol-sh");
      expect(inbox[0].sender_scheme).toBe("0208");
      expect(inbox[0].sender_id).toBe("0987654321");
      expect(inbox[0].file_name).toBe("IN-RECV-7777.xml");
      expect(inbox[0].document_number).toBe("IN-RECV-7777");
      expect(inbox[0].parse_status).toBe("ok");

      // Replay of the same event id is a no-op 200 and never duplicates.
      const replay = await app.request("/api/v1/webhooks/peppol", {
        method: "POST",
        headers: {
          "x-peppol-sh-signature": signature,
          "x-peppol-sh-timestamp": String(ts),
          "x-peppol-sh-event-id": "ev-oss-recv-1",
          "Content-Type": "application/json",
        },
        body,
      });
      expect(replay.status).toBe(200);
      const afterReplay = getDb()
        .query("SELECT COUNT(*) as c FROM einvoice_inbox WHERE provider_message_id = 'doc_recv_1'")
        .get() as { c: number };
      expect(afterReplay.c).toBe(1);
    } finally {
      // Restore the suite's default transport + env for later describes.
      updateSettings({ peppol_transport: "fake" });
      delete process.env.PEPPOL_SH_API_KEY;
      delete process.env.PEPPOL_SH_WEBHOOK_SECRET;
      restorePeppolEnv();
    }
  });
});

describe("participant registration (§10)", () => {
  test("conflict: servedElsewhere produces status conflict and no registration attempt", async () => {
    resetFakeTransport();
    clearTransmissions();
    fakeTransportState.capability = {
      exists: true,
      documentTypes: ["invoice"],
      accessPointName: "Acme AP",
      servedElsewhere: true,
    };
    const state = await registerReceiver({
      participant: { scheme: "9930", value: "DE123456789" },
      legalName: "Other GmbH",
      countryCode: "DE",
      contactEmail: "other@example.com",
    });
    expect(state.status).toBe("conflict");
    expect(state.detail).toContain("Acme AP");
    expect(fakeTransportState.registrations).toHaveLength(0);
    // The conflict is recorded so the UI can show it.
    const conflictRow = getDb()
      .query("SELECT status FROM peppol_participants WHERE scheme = '9930'")
      .get() as { status: string };
    expect(conflictRow.status).toBe("conflict");
    fakeTransportState.capability = {
      exists: true,
      documentTypes: ["invoice", "credit-note"],
      accessPointName: null,
      servedElsewhere: false,
    };
  });

  test("refresh polls getRegistration; deregister calls the provider", async () => {
    resetFakeTransport();
    clearTransmissions();
    fakeTransportState.registrationState = {
      providerRef: "fake-reg-1",
      status: "active",
      actionUrl: null,
      detail: null,
    };
    const refreshed = await (
      await import("../services/einvoice-transport.service")
    ).refreshParticipant();
    expect(refreshed?.status).toBe("active");

    const deregistered = await (
      await import("../services/einvoice-transport.service")
    ).deregisterParticipant();
    expect(deregistered).toBe(true);
    expect(fakeTransportState.registrationRefs).toContain("fake-reg-1");
  });

  test("transport error surfaces as a TransportError", async () => {
    resetFakeTransport();
    clearTransmissions();
    fakeTransportState.nextRegisterError = new Error("boom");
    await expect(
      registerReceiver({
        participant: { scheme: "0208", value: "X" },
        legalName: "X",
        countryCode: "BE",
        contactEmail: "x@example.com",
      }),
    ).rejects.toBeInstanceOf(TransportError);
  });
});

describe("peppol.sh driver (stubbed fetch)", () => {
  let originalFetch: typeof fetch;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
    process.env.PEPPOL_SH_API_KEY = "test-key";
    process.env.PEPPOL_SH_WEBHOOK_SECRET = "webhook-secret";
    process.env.PEPPOL_SH_BASE_URL = "https://api.peppol.sh";
    resetEnvCache();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    delete process.env.PEPPOL_SH_API_KEY;
    delete process.env.PEPPOL_SH_WEBHOOK_SECRET;
    resetEnvCache();
  });

  test("send builds the DocumentCreate body with auth + company scoping", async () => {
    updateSettings({ peppol_company_id: "com_abc" });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return new Response(JSON.stringify({ id: "prov-1", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const receipt = await peppolShTransport.send(sendCtx("INV-1"));
    expect(receipt.providerMessageId).toBe("prov-1");
    expect(receipt.status).toBe("sent");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.peppol.sh/v1/documents");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers["Idempotency-Key"]).toBeUndefined();

    const body = JSON.parse(String(calls[0].init.body));
    expect(body.company_id).toBe("com_abc");
    expect(body.idempotency_key).toBe("tx-42");
    expect(body.type).toBe("invoice");
    expect(body.number).toBe("INV-1");
    expect(body.issue_date).toBe("2026-08-01");
    expect(body.currency).toBe("EUR");
    expect(body.from).toEqual({
      name: "Seller BV",
      tax_id: "BE0123456789",
      peppol_id: "0208:A",
      address: { street: "Hoofdstraat 5", city: "Brussel", postal_code: "1000" },
    });
    expect(body.to).toEqual({
      name: "Buyer BV",
      tax_id: "BE0123456789",
      peppol_id: "0208:B",
      address: { street: "Kerkstraat 1", city: "Antwerpen", postal_code: "2000" },
    });
    expect(body.lines).toEqual([
      { description: "Consulting", quantity: 1, unit: "C62", unit_price: 500, tax_rate: 21 },
    ]);
  });

  test("provisions the sender company lazily and caches its id", async () => {
    updateSettings({ peppol_company_id: "" });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: init as RequestInit });
      if (String(url).endsWith("/v1/companies")) {
        return new Response(JSON.stringify({ id: "com_new", name: "Seller BV" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ id: "prov-2", status: "queued" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const receipt = await peppolShTransport.send(sendCtx("INV-2"));
    expect(receipt.providerMessageId).toBe("prov-2");
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://api.peppol.sh/v1/companies");
    const provision = JSON.parse(String(calls[0].init.body));
    expect(provision.name).toBe("Seller BV");
    expect(provision.tax_id).toBe("BE0123456789");
    expect(provision.country).toBe("BE");
    const sent = JSON.parse(String(calls[1].init.body));
    expect(sent.company_id).toBe("com_new");
    expect(getSetting("peppol_company_id")).toBe("com_new");
  });

  test("maps provider errors to TransportHttpError with retryability", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 400 })) as unknown as typeof fetch;
    await expect(peppolShTransport.send(sendCtx("INV"))).rejects.toMatchObject({
      statusCode: 400,
    });

    globalThis.fetch = (async () =>
      new Response("busy", { status: 429 })) as unknown as typeof fetch;
    const err429 = await peppolShTransport.send(sendCtx("INV")).catch((e) => e);
    expect(err429).toBeInstanceOf(TransportHttpError);
    expect(err429.isRetryable()).toBe(true);

    // Network-level failure has no status code and is retryable.
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const netErr = await peppolShTransport.send(sendCtx("INV")).catch((e) => e);
    expect(netErr).toBeInstanceOf(TransportHttpError);
    expect(netErr.statusCode).toBeNull();
    expect(netErr.isRetryable()).toBe(true);
  });

  test("parseWebhook verifies HMAC over the raw body with a 5-minute window", async () => {
    const secret = "webhook-secret";
    const body = JSON.stringify({
      id: "evt-1",
      type: "delivered",
      document_id: "prov-1",
      document_number: "INV-1",
      to_status: "delivered",
      created_at: "2026-08-11T10:00:00Z",
    });
    const ts = Math.floor(Date.now() / 1000);

    const sign = (b: string) => createHmac("sha256", secret).update(b).digest("hex");

    // Valid signature + fresh timestamp passes.
    const ok = await peppolShTransport.parseWebhook({
      rawBody: body,
      headers: {
        "x-peppol-sh-signature": sign(body),
        "x-peppol-sh-timestamp": String(ts),
        "x-peppol-sh-event-id": "ev-1",
      },
    });
    expect(ok.kind).toBe("status");
    expect((ok as Extract<TransportWebhookResult, { kind: "status" }>).providerMessageId).toBe(
      "prov-1",
    );
    expect((ok as Extract<TransportWebhookResult, { kind: "status" }>).status).toBe("delivered");

    // Tampered body fails.
    await expect(
      peppolShTransport.parseWebhook({
        rawBody: body.replace("delivered", "failed"),
        headers: {
          "x-peppol-sh-signature": sign(body),
          "x-peppol-sh-timestamp": String(ts),
          "x-peppol-sh-event-id": "ev-2",
        },
      }),
    ).rejects.toThrow("Invalid webhook signature");

    // 6-minute-old timestamp fails (5-minute window).
    await expect(
      peppolShTransport.parseWebhook({
        rawBody: body,
        headers: {
          "x-peppol-sh-signature": sign(body),
          "x-peppol-sh-timestamp": String(ts - 360),
          "x-peppol-sh-event-id": "ev-3",
        },
      }),
    ).rejects.toThrow("timestamp");
  });

  test("a failed delivery event maps to a rejected status with the message as detail", async () => {
    const secret = "webhook-secret";
    const body = JSON.stringify({
      id: "evt-2",
      type: "failed",
      document_id: "prov-1",
      message: "SMP lookup failed: participant not found",
      to_status: "failed",
    });
    const ts = Math.floor(Date.now() / 1000);
    const sign = (b: string) => createHmac("sha256", secret).update(b).digest("hex");

    const res = await peppolShTransport.parseWebhook({
      rawBody: body,
      headers: {
        "x-peppol-sh-signature": sign(body),
        "x-peppol-sh-timestamp": String(ts),
        "x-peppol-sh-event-id": "ev-4",
      },
    });
    expect(res.kind).toBe("status");
    const st = res as Extract<TransportWebhookResult, { kind: "status" }>;
    expect(st.status).toBe("rejected");
    expect(st.detail).toBe("SMP lookup failed: participant not found");
  });

  test("lookup queries the SMP domain and maps the capability shape", async () => {
    updateSettings({ peppol_environment: "test" });
    globalThis.fetch = (async (url: unknown) => {
      expect(String(url)).toBe("https://api.peppol.sh/v1/lookup/0208:0456123456?domain=smk");
      return new Response(
        JSON.stringify({
          participant_id: { scheme: "0208", id: "0456123456" },
          services: [
            {
              document_type_id:
                "busdox-docid-qns::urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
              document_type_name: "Peppol BIS Billing UBL Invoice V3",
              process_id: "cenbii-procid-ubl::urn:fdc:peppol.eu:poacc:billing:3.0",
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const cap = await peppolShTransport.lookupParticipant({
      scheme: "0208",
      value: "0456123456",
    });
    expect(cap.exists).toBe(true);
    expect(cap.documentTypes).toEqual(["invoice"]);
    expect(cap.accessPointName).toBeNull();
    expect(cap.servedElsewhere).toBe(false);

    // Production environment queries the sml domain.
    updateSettings({ peppol_environment: "production" });
    globalThis.fetch = (async (url: unknown) => {
      expect(String(url)).toBe("https://api.peppol.sh/v1/lookup/0208:0456123456?domain=sml");
      return new Response(JSON.stringify({ services: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const prod = await peppolShTransport.lookupParticipant({
      scheme: "0208",
      value: "0456123456",
    });
    expect(prod.exists).toBe(true);
    expect(prod.documentTypes).toEqual([]);

    // 404 means "not on the network", not an error.
    globalThis.fetch = (async () =>
      new Response("not found", { status: 404 })) as unknown as typeof fetch;
    const missing = await peppolShTransport.lookupParticipant({
      scheme: "0208",
      value: "9999999999",
    });
    expect(missing.exists).toBe(false);
    expect(missing.documentTypes).toEqual([]);
  });

  test("end-to-end: transmit flows through the real driver (network lookup → send)", async () => {
    resetFakeTransport();
    clearTransmissions();
    const prevCompanyId = getSetting("peppol_company_id");
    const prevEnvironment = getSetting("peppol_environment");
    // The lookup test above leaves the environment at "production"; the E2E
    // flow asserts the test SMP domain, so pin it explicitly.
    updateSettings({
      peppol_transport: "peppol-sh",
      peppol_company_id: "com_e2e",
      peppol_environment: "test",
    });
    try {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      globalThis.fetch = (async (url: unknown, init: unknown) => {
        const u = String(url);
        calls.push({ url: u, init: init as RequestInit });
        if (u.includes("/v1/lookup/")) {
          return new Response(
            JSON.stringify({
              participant_id: { scheme: "0208", id: "0456123456" },
              services: [
                {
                  document_type_id:
                    "busdox-docid-qns::urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
                  document_type_name: "Peppol BIS Billing UBL Invoice V3",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ id: "doc_e2e_1", status: "queued" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      // Enqueue: the orchestrator runs the real driver's SMP lookup first.
      const enq = await authed(`/api/v1/einvoices/${invoiceId}/transmit`, { method: "POST" });
      expect(enq.status).toBe(201);
      const enqBody = (await enq.json()) as { data: { transmission_id: string } };
      const transmissionId = enqBody.data.transmission_id;

      // Worker tick: the real driver sends the JSON body to POST /v1/documents.
      await processTransportQueue();

      expect(statusOf(transmissionId)).toBe("sent");
      expect(String(row(transmissionId).provider_message_id)).toBe("doc_e2e_1");
      expect(String(row(transmissionId).transport_id)).toBe("peppol-sh");

      const lookupCall = calls.find((c) => c.url.includes("/v1/lookup/"));
      expect(lookupCall?.url).toBe("https://api.peppol.sh/v1/lookup/0208:0456123456?domain=smk");

      const sendCall = calls.find((c) => c.url.endsWith("/v1/documents"));
      expect(sendCall).toBeDefined();
      const body = JSON.parse(String(sendCall?.init.body));
      expect(body.company_id).toBe("com_e2e");
      expect(body.idempotency_key).toBe(transmissionId);
      expect(body.type).toBe("invoice");
      expect(body.currency).toBe("EUR");
      const invoiceNumber = (
        getDb().query("SELECT invoice_number FROM invoices WHERE id = ?").get(invoiceId) as {
          invoice_number: string;
        }
      ).invoice_number;
      expect(body.number).toBe(invoiceNumber);

      // Parties come from the tenant's company profile and the customer.
      expect(body.from).toMatchObject({
        name: "Seller BV",
        tax_id: "BE0123456789",
        peppol_id: "0208:0123456789",
      });
      expect(body.to).toMatchObject({
        name: "Buyer BV",
        peppol_id: "0208:0456123456",
      });
      expect(body.lines).toHaveLength(1);
      expect(body.lines[0]).toMatchObject({
        description: "Consulting",
        quantity: 1,
        unit_price: 500,
        unit: "C62",
        tax_rate: 0,
      });
    } finally {
      updateSettings({ peppol_transport: "fake" });
      if (prevCompanyId) updateSettings({ peppol_company_id: prevCompanyId });
      else updateSettings({ peppol_company_id: "" });
      if (prevEnvironment) updateSettings({ peppol_environment: prevEnvironment });
      else updateSettings({ peppol_environment: "" });
    }
  });

  test("end-to-end: a permanent driver error fails the transmission", async () => {
    resetFakeTransport();
    clearTransmissions();
    const prevCompanyId = getSetting("peppol_company_id");
    const prevEnvironment = getSetting("peppol_environment");
    updateSettings({
      peppol_transport: "peppol-sh",
      peppol_company_id: "com_fail",
      peppol_environment: "test",
    });
    try {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      globalThis.fetch = (async (url: unknown, init: unknown) => {
        const u = String(url);
        calls.push({ url: u, init: init as RequestInit });
        if (u.includes("/v1/lookup/")) {
          return new Response(
            JSON.stringify({
              participant_id: { scheme: "0208", id: "0456123456" },
              services: [
                {
                  document_type_id:
                    "busdox-docid-qns::urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
                  document_type_name: "Peppol BIS Billing UBL Invoice V3",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        // Permanent 4xx: the provider accepted nothing and retries would not
        // plausibly succeed, so the orchestrator must fail the row at once.
        return new Response("provider says no", { status: 400 });
      }) as unknown as typeof fetch;

      const enq = await authed(`/api/v1/einvoices/${invoiceId}/transmit`, { method: "POST" });
      expect(enq.status).toBe(201);
      const enqBody = (await enq.json()) as { data: { transmission_id: string } };
      const transmissionId = enqBody.data.transmission_id;

      await processTransportQueue();

      // Terminal after a single attempt: no provider id, no reschedule.
      expect(statusOf(transmissionId)).toBe("failed");
      expect(row(transmissionId).provider_message_id).toBeNull();
      expect(row(transmissionId).next_attempt_at).toBeNull();
      expect(String(row(transmissionId).status_detail)).toContain(
        "POST /v1/documents failed (400)",
      );

      const attempts = listTransmissions(invoiceId).attempts[transmissionId];
      expect(attempts).toHaveLength(1);
      expect(attempts[0].status_code).toBe(400);
      expect(attempts[0].error_message).toContain("POST /v1/documents failed");
      expect(attempts[0].response_body).toBe("provider says no");

      const sendCalls = calls.filter((c) => c.url.endsWith("/v1/documents"));
      expect(sendCalls).toHaveLength(1);
    } finally {
      updateSettings({ peppol_transport: "fake" });
      if (prevCompanyId) updateSettings({ peppol_company_id: prevCompanyId });
      else updateSettings({ peppol_company_id: "" });
      if (prevEnvironment) updateSettings({ peppol_environment: prevEnvironment });
      else updateSettings({ peppol_environment: "" });
    }
  });
});

describe("France transport selection", () => {
  let frCustomerId: string;
  let frInvoiceId: string;
  const prev: Record<string, string | null> = {};

  // The brief snapshots these at describe scope, but describe bodies run at
  // module load — before the top-level beforeAll opens the DB. A describe
  // beforeAll runs after it, so snapshot here instead.
  beforeAll(() => {
    prev.france_enabled = getSetting("france_enabled");
    prev.france_transport = getSetting("france_transport");
    prev.france_sender_siren = getSetting("france_sender_siren");
  });

  test("setup French customer + invoice", async () => {
    const cust = await authed("/api/v1/customers", {
      method: "POST",
      body: JSON.stringify({
        name: "Acheteur FR",
        country: "FR",
        siren: "123456789",
        address_line1: "1 rue A",
        city: "Paris",
        postal_code: "75001",
      }),
    });
    frCustomerId = ((await cust.json()) as any).data.id;
    const inv = await authed("/api/v1/invoices", {
      method: "POST",
      body: JSON.stringify({
        customer_id: frCustomerId,
        issue_date: "2026-08-14",
        currency: "EUR",
        items: [{ description: "Service", quantity: 1, unit_price: 100 }],
      }),
    });
    frInvoiceId = ((await inv.json()) as any).data.id;
  });

  test("enqueue resolves the france transport for a SIREN customer", async () => {
    updateSettings({
      france_enabled: "true",
      france_transport: "fake",
      france_sender_siren: "987654321",
    });
    resetFakeTransport();
    const res = await authed(`/api/v1/einvoices/${frInvoiceId}/transmit`, { method: "POST" });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as any;
    const row = getDb()
      .query(
        "SELECT transport_id, sender_scheme, sender_id, receiver_scheme, receiver_id FROM einvoice_transmissions WHERE id = ?",
      )
      .get(data.transmission_id) as Record<string, unknown>;
    expect(row.transport_id).toBe("fake");
    expect(row.sender_scheme).toBe("0009");
    expect(row.sender_id).toBe("987654321");
    expect(row.receiver_scheme).toBe("0009");
    expect(row.receiver_id).toBe("123456789");
    // emitted as Factur-X (zugferd profile)
    const doc = getDb()
      .query(
        "SELECT format FROM einvoice_documents WHERE id = (SELECT einvoice_document_id FROM einvoice_transmissions WHERE id = ?)",
      )
      .get(data.transmission_id) as { format: string };
    expect(doc.format).toBe("zugferd");
    // france lookup cache written
    const cust = getDb()
      .query("SELECT france_reachable, france_checked_at FROM customers WHERE id = ?")
      .get(frCustomerId) as Record<string, unknown>;
    expect(cust.france_reachable).toBe(1);
    expect(cust.france_checked_at).toBeTruthy();
  });

  test("france disabled → falls back to PEPPOL or a clear 409", async () => {
    updateSettings({ france_enabled: "false" });
    const res = await authed(`/api/v1/einvoices/${frInvoiceId}/transmit`, { method: "POST" });
    // No PEPPOL receiver on this customer → receiver_id_missing
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).code).toBe("receiver_id_missing");
  });

  test("france sender SIREN missing → 422 france_sender_missing", async () => {
    updateSettings({ france_enabled: "true", france_transport: "fake", france_sender_siren: "" });
    const res = await authed(`/api/v1/einvoices/${frInvoiceId}/transmit`, { method: "POST" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).code).toBe("france_sender_missing");
  });

  test("france/lookup route resolves SIREN through the france transport", async () => {
    updateSettings({ france_enabled: "true", france_transport: "fake" });
    resetFakeTransport();
    fakeTransportState.capability = {
      exists: true,
      documentTypes: ["invoice", "credit-note"],
      accessPointName: "Qonto",
      servedElsewhere: false,
    };
    const res = await authed("/api/v1/einvoices/france/lookup", {
      method: "POST",
      body: JSON.stringify({ siren: "123456789", customer_id: frCustomerId }),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data.exists).toBe(true);
    expect(fakeTransportState.lookups.at(-1)).toEqual({ scheme: "0009", value: "123456789" });
    const cust = getDb()
      .query("SELECT france_reachable FROM customers WHERE id = ?")
      .get(frCustomerId) as { france_reachable: number };
    expect(cust.france_reachable).toBe(1);
  });

  test("restore settings", () => {
    updateSettings({
      france_enabled: prev.france_enabled ?? "false",
      france_transport: prev.france_transport ?? "fake",
      france_sender_siren: prev.france_sender_siren ?? "",
    });
  });
});
