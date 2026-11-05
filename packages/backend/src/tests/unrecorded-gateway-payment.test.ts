import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { unlinkSync } from "node:fs";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import {
  createInvoice,
  deleteInvoice,
  finaliseForSending,
  getInvoice,
  markComplete,
  voidInvoice,
} from "../services/invoice.service";
import { paypalGateway } from "../services/payment-gateways/paypal.gateway";
import { stripeGateway } from "../services/payment-gateways/stripe.gateway";
import { setStripeClientResolver } from "../services/stripe.service";
import { resetEnvCache } from "../utils/env";

// A gateway that confirms a payment the invoice will not take (voided or
// trashed while the customer was paying) has moved real money. These tests
// pin that it leaves an error log and an activity entry on the invoice, the
// way auto-bill already reports a captured charge it cannot record.

const TEST_DB = "./data/test-unrecorded-gateway-payment.db";
let customerId: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "unrecordedpaymenttestpass";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.PAYPAL_CLIENT_ID = "pp_client";
  process.env.PAYPAL_SECRET = "pp_secret";
  process.env.PAYPAL_WEBHOOK_ID = "pp_webhook";
  resetEnvCache();

  initDatabase();
  runMigrations();
  await seed();

  customerId = crypto.randomBytes(16).toString("hex");
  getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [customerId, "Late Payer"]);
});

afterAll(() => {
  closeDatabase();
  for (const key of [
    "STRIPE_WEBHOOK_SECRET",
    "PAYPAL_CLIENT_ID",
    "PAYPAL_SECRET",
    "PAYPAL_WEBHOOK_ID",
  ]) {
    delete process.env[key];
  }
  resetEnvCache();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

afterEach(() => {
  setStripeClientResolver(null);
  globalThis.fetch = realFetch;
});

function sentInvoice(amount: number) {
  const inv = createInvoice({
    customer_id: customerId,
    issue_date: "2026-11-05",
    currency: "USD",
    items: [{ description: "Work", quantity: 1, unit_price: amount }],
  });
  finaliseForSending(inv.id);
  return getInvoice(inv.id)!;
}

function unrecordedEntries(invoiceId: string) {
  return getDb()
    .query(
      "SELECT metadata FROM activity_log WHERE action = 'payment_unrecorded' AND resource_id = ?",
    )
    .all(invoiceId) as { metadata: string }[];
}

function paymentCount(invoiceId: string): number {
  const row = getDb()
    .query("SELECT COUNT(*) as count FROM payments WHERE invoice_id = ?")
    .get(invoiceId) as { count: number };
  return row.count;
}

// --- Stripe --------------------------------------------------------------

function stripeWebhook(
  invoiceId: string | null,
  total: number,
  paymentIntent: string | null,
  sessionId?: string,
) {
  const event = {
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        metadata: invoiceId ? { invoice_id: invoiceId } : {},
        amount_total: Math.round(total * 100),
        currency: "usd",
        payment_intent: paymentIntent,
      },
    },
  };
  setStripeClientResolver(async () => ({ webhooks: { constructEvent: () => event } }) as any);
  return stripeGateway.handleWebhook({
    rawBody: JSON.stringify(event),
    headers: { "stripe-signature": "t=1,v1=test" },
  });
}

describe("Stripe webhook for an invoice that no longer takes payments", () => {
  test("control: an open invoice records the payment and reports nothing", async () => {
    const inv = sentInvoice(120);
    const result = await stripeWebhook(inv.id, inv.total, "pi_open");
    expect(result.recorded).toBe(true);
    expect(paymentCount(inv.id)).toBe(1);
    expect(unrecordedEntries(inv.id)).toHaveLength(0);
  });

  test("a voided invoice is reported to the merchant", async () => {
    const inv = sentInvoice(120);
    voidInvoice(inv.id);
    const result = await stripeWebhook(inv.id, inv.total, "pi_voided");
    expect(result.recorded).toBe(false);
    expect(paymentCount(inv.id)).toBe(0);

    const entries = unrecordedEntries(inv.id);
    expect(entries).toHaveLength(1);
    const meta = JSON.parse(entries[0].metadata);
    expect(meta.gateway).toBe("Stripe");
    expect(meta.reference).toBe("pi_voided");
    expect(meta.amount).toBe(120);
  });

  test("a trashed invoice is reported to the merchant", async () => {
    const inv = sentInvoice(75);
    deleteInvoice(inv.id);
    const result = await stripeWebhook(inv.id, inv.total, "pi_trashed");
    expect(result.recorded).toBe(false);
    expect(paymentCount(inv.id)).toBe(0);
    expect(unrecordedEntries(inv.id)).toHaveLength(1);
  });

  test("a redelivered event is logged once", async () => {
    const inv = sentInvoice(40);
    voidInvoice(inv.id);
    await stripeWebhook(inv.id, inv.total, "pi_twice");
    const again = await stripeWebhook(inv.id, inv.total, "pi_twice");
    expect(again.recorded).toBe(false);
    expect(unrecordedEntries(inv.id)).toHaveLength(1);
  });

  test("a redelivered event for a recorded payment is not reported after completion", async () => {
    const inv = sentInvoice(60);
    expect((await stripeWebhook(inv.id, inv.total, "pi_done")).recorded).toBe(true);
    expect(markComplete(inv.id)?.status).toBe("complete");
    const again = await stripeWebhook(inv.id, inv.total, "pi_done");
    expect(again.recorded).toBe(false);
    expect(paymentCount(inv.id)).toBe(1);
    expect(unrecordedEntries(inv.id)).toHaveLength(0);
  });

  test("a zero amount is not reported", async () => {
    const inv = sentInvoice(30);
    voidInvoice(inv.id);
    const result = await stripeWebhook(inv.id, 0, "pi_zero");
    expect(result.recorded).toBe(false);
    expect(unrecordedEntries(inv.id)).toHaveLength(0);
  });

  test("without a payment intent, a redelivered session is logged once", async () => {
    const inv = sentInvoice(25);
    voidInvoice(inv.id);
    await stripeWebhook(inv.id, inv.total, null, "cs_no_intent");
    await stripeWebhook(inv.id, inv.total, null, "cs_no_intent");
    const entries = unrecordedEntries(inv.id);
    expect(entries).toHaveLength(1);
    expect(JSON.parse(entries[0].metadata).reference).toBe("cs_no_intent");
  });

  test("a session without an invoice is not reported", async () => {
    const before = getDb()
      .query("SELECT COUNT(*) as count FROM activity_log WHERE action = 'payment_unrecorded'")
      .get() as { count: number };
    const result = await stripeWebhook(null, 10, "pi_other");
    expect(result).toEqual({ handled: true, recorded: false });
    const after = getDb()
      .query("SELECT COUNT(*) as count FROM activity_log WHERE action = 'payment_unrecorded'")
      .get() as { count: number };
    expect(after.count).toBe(before.count);
  });
});

// --- PayPal --------------------------------------------------------------

function mockPayPal(captureId: string, value: string) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    let body: unknown = {};
    if (url.endsWith("/v1/oauth2/token")) body = { access_token: "pp_token" };
    else if (url.endsWith("/v1/notifications/verify-webhook-signature"))
      body = { verification_status: "SUCCESS" };
    else if (url.endsWith("/capture"))
      body = {
        purchase_units: [{ payments: { captures: [{ id: captureId, amount: { value } }] } }],
      };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

function paypalWebhook(invoiceId: string) {
  return paypalGateway.handleWebhook({
    rawBody: JSON.stringify({
      event_type: "CHECKOUT.ORDER.APPROVED",
      resource: { id: "ORDER-1", purchase_units: [{ reference_id: invoiceId }] },
    }),
    headers: {},
  });
}

describe("PayPal webhook for an invoice that no longer takes payments", () => {
  test("control: an open invoice records the capture and reports nothing", async () => {
    const inv = sentInvoice(88);
    mockPayPal("CAP-OPEN", "88.00");
    const result = await paypalWebhook(inv.id);
    expect(result.recorded).toBe(true);
    expect(paymentCount(inv.id)).toBe(1);
    expect(unrecordedEntries(inv.id)).toHaveLength(0);
  });

  test("a voided invoice is reported after the order was captured", async () => {
    const inv = sentInvoice(88);
    voidInvoice(inv.id);
    mockPayPal("CAP-VOIDED", "88.00");
    const result = await paypalWebhook(inv.id);
    expect(result.recorded).toBe(false);
    expect(paymentCount(inv.id)).toBe(0);

    const entries = unrecordedEntries(inv.id);
    expect(entries).toHaveLength(1);
    const meta = JSON.parse(entries[0].metadata);
    expect(meta.gateway).toBe("PayPal");
    expect(meta.reference).toBe("CAP-VOIDED");
    expect(meta.amount).toBe(88);
  });
});
