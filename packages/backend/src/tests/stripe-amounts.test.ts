import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { unlinkSync } from "node:fs";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { createInvoice, finaliseForSending, getInvoice } from "../services/invoice.service";
import {
  chargeOffSession,
  createCheckoutSession,
  fromStripeAmount,
  handlePaymentSuccess,
  setStripeClientResolver,
  toStripeAmount,
} from "../services/stripe.service";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-stripe-amounts.db";
let customerId: string;

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "stripeamountstestpass";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  resetEnvCache();

  initDatabase();
  runMigrations();
  await seed();

  customerId = crypto.randomBytes(16).toString("hex");
  getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [customerId, "Yen Co"]);
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

afterEach(() => setStripeClientResolver(null));

describe("Stripe amount conversion", () => {
  test("two-decimal currencies use cents", () => {
    expect(toStripeAmount(50.25, "USD")).toBe(5025);
    expect(toStripeAmount(19.99, "eur")).toBe(1999);
    expect(fromStripeAmount(5025, "usd")).toBe(50.25);
  });

  test("zero-decimal currencies are sent as whole units", () => {
    expect(toStripeAmount(5000, "JPY")).toBe(5000);
    expect(toStripeAmount(12000, "krw")).toBe(12000);
    expect(fromStripeAmount(5000, "jpy")).toBe(5000);
  });

  test("three-decimal currencies use thousandths ending in 0", () => {
    expect(toStripeAmount(10.5, "KWD")).toBe(10500);
    expect(fromStripeAmount(10500, "kwd")).toBe(10.5);
  });
});

function checkoutClient(calls: any[]) {
  return async () =>
    ({
      checkout: {
        sessions: {
          create: async (params: any) => {
            calls.push(params);
            return { url: "https://checkout.example/session" };
          },
        },
      },
    }) as any;
}

function checkoutOpts(amount: number, currency: string) {
  return {
    invoiceId: "inv_1",
    shareToken: "tok_1",
    amount,
    currency,
    customerEmail: null,
    successUrl: "https://example.test/ok",
    cancelUrl: "https://example.test/cancel",
  };
}

describe("createCheckoutSession amounts", () => {
  test("a JPY balance is not multiplied by 100", async () => {
    const calls: any[] = [];
    setStripeClientResolver(checkoutClient(calls));
    await createCheckoutSession(checkoutOpts(5000, "JPY"));
    expect(calls[0].line_items[0].price_data.unit_amount).toBe(5000);
    expect(calls[0].line_items[0].price_data.currency).toBe("jpy");
  });

  test("a USD balance is still sent in cents", async () => {
    const calls: any[] = [];
    setStripeClientResolver(checkoutClient(calls));
    await createCheckoutSession(checkoutOpts(50.25, "USD"));
    expect(calls[0].line_items[0].price_data.unit_amount).toBe(5025);
  });
});

function chargeClient(calls: any[]) {
  return async () =>
    ({
      paymentIntents: {
        create: async (params: any) => {
          calls.push(params);
          return { id: "pi_1", status: "succeeded" };
        },
      },
    }) as any;
}

describe("chargeOffSession amounts", () => {
  test("a JPY auto-bill charges the invoice amount, not 100x", async () => {
    const calls: any[] = [];
    setStripeClientResolver(chargeClient(calls));
    await chargeOffSession({
      invoiceId: "inv_jpy",
      amount: 5000,
      currency: "JPY",
      gatewayCustomerId: "cus_1",
      gatewayMethodId: "pm_1",
      attemptNo: 1,
    });
    expect(calls[0].amount).toBe(5000);
  });

  test("an EUR auto-bill is still charged in cents", async () => {
    const calls: any[] = [];
    setStripeClientResolver(chargeClient(calls));
    await chargeOffSession({
      invoiceId: "inv_eur",
      amount: 125.5,
      currency: "EUR",
      gatewayCustomerId: "cus_1",
      gatewayMethodId: "pm_1",
      attemptNo: 1,
    });
    expect(calls[0].amount).toBe(12550);
  });
});

function sentInvoice(currency: string, amount: number) {
  const inv = createInvoice({
    customer_id: customerId,
    issue_date: "2026-11-05",
    currency,
    items: [{ description: "Work", quantity: 1, unit_price: amount }],
  });
  finaliseForSending(inv.id);
  return getInvoice(inv.id)!;
}

describe("handlePaymentSuccess amounts", () => {
  test("a JPY checkout records the amount Stripe reports in yen", () => {
    const inv = sentInvoice("JPY", 5000);
    handlePaymentSuccess({
      metadata: { invoice_id: inv.id },
      amount_total: inv.total,
      currency: "jpy",
      payment_intent: "pi_jpy",
    } as any);
    const after = getInvoice(inv.id)!;
    expect(after.amount_paid).toBe(inv.total);
    expect(after.status).toBe("paid");
  });

  test("a USD checkout still converts cents back", () => {
    const inv = sentInvoice("USD", 50.25);
    handlePaymentSuccess({
      metadata: { invoice_id: inv.id },
      amount_total: Math.round(inv.total * 100),
      currency: "usd",
      payment_intent: "pi_usd",
    } as any);
    expect(getInvoice(inv.id)!.amount_paid).toBe(inv.total);
  });
});
