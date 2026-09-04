import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { unlinkSync } from "node:fs";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import {
  isStripeConfigured,
  saveMethodFromCheckoutSession,
  setStripeClientResolver,
  setStripeConfiguredChecker,
} from "../services/stripe.service";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-auto-bill.db";
let customerId: string;

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "autobilltestpass";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  resetEnvCache();

  initDatabase();
  runMigrations();
  await seed();

  customerId = crypto.randomBytes(16).toString("hex");
  getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [customerId, "Billing Co"]);
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

describe("stripe client resolution", () => {
  afterEach(() => {
    setStripeClientResolver(null);
    setStripeConfiguredChecker(null);
  });

  test("isStripeConfigured defers to a registered checker", () => {
    setStripeConfiguredChecker(() => true);
    expect(isStripeConfigured()).toBe(true);
    setStripeConfiguredChecker(() => false);
    expect(isStripeConfigured()).toBe(false);
  });

  test("without a checker it falls back to env", () => {
    // Neither STRIPE_SECRET_KEY nor STRIPE_WEBHOOK_SECRET is set in this suite.
    expect(isStripeConfigured()).toBe(false);
  });
});

import {
  deleteMethod,
  getDefaultMethod,
  listMethodsForCustomer,
  saveMethod,
} from "../services/customer-payment-method.service";

describe("customer payment methods", () => {
  test("the first saved method becomes the default", () => {
    const m = saveMethod({
      customerId,
      gatewayCustomerId: "cus_1",
      gatewayMethodId: "pm_1",
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
      consentText: "You authorise Acme to charge this card for future invoices.",
    });
    expect(m.is_default).toBe(1);
    expect(getDefaultMethod(customerId)?.gateway_method_id).toBe("pm_1");
  });

  test("a second saved method does not steal the default", () => {
    saveMethod({ customerId, gatewayCustomerId: "cus_1", gatewayMethodId: "pm_2", last4: "1111" });
    expect(getDefaultMethod(customerId)?.gateway_method_id).toBe("pm_1");
    expect(listMethodsForCustomer(customerId)).toHaveLength(2);
  });

  test("re-saving the same gateway method is idempotent", () => {
    const before = listMethodsForCustomer(customerId).length;
    saveMethod({ customerId, gatewayCustomerId: "cus_1", gatewayMethodId: "pm_1", last4: "4242" });
    expect(listMethodsForCustomer(customerId)).toHaveLength(before);
  });

  test("consent text is stored verbatim with a timestamp", () => {
    const stored = listMethodsForCustomer(customerId).find((m) => m.gateway_method_id === "pm_1")!;
    expect(stored.consent_text).toBe("You authorise Acme to charge this card for future invoices.");
    expect(stored.consent_at).toBeTruthy();
  });

  test("a customer with no methods has no default", () => {
    const other = crypto.randomBytes(16).toString("hex");
    getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [other, "No Cards Co"]);
    expect(getDefaultMethod(other)).toBeNull();
    expect(listMethodsForCustomer(other)).toHaveLength(0);
  });
});

function makeCustomer(name: string): string {
  const id = crypto.randomBytes(16).toString("hex");
  getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [id, name]);
  return id;
}

function stubDetach(behavior: () => Promise<unknown>) {
  setStripeClientResolver(async () => ({ paymentMethods: { detach: behavior } }) as any);
}

describe("deleting payment methods", () => {
  afterEach(() => {
    setStripeClientResolver(null);
  });

  test("a successful detach removes the local row", async () => {
    const cid = makeCustomer("Delete Co 1");
    const m = saveMethod({
      customerId: cid,
      gatewayCustomerId: "cus_d1",
      gatewayMethodId: "pm_d1",
      last4: "0001",
    });
    stubDetach(async () => ({}));

    const result = await deleteMethod(m.id, cid);

    expect(result).toEqual({ success: true });
    expect(listMethodsForCustomer(cid)).toHaveLength(0);
  });

  test("a failed detach returns failure and the local row survives", async () => {
    const cid = makeCustomer("Delete Co 2");
    const m = saveMethod({
      customerId: cid,
      gatewayCustomerId: "cus_d2",
      gatewayMethodId: "pm_d2",
      last4: "0002",
    });
    stubDetach(async () => {
      throw new Error("network error, no code");
    });

    const result = await deleteMethod(m.id, cid);

    expect(result).toEqual({
      success: false,
      error: "Could not revoke the card at the payment provider",
    });
    expect(listMethodsForCustomer(cid)).toHaveLength(1);
    expect(listMethodsForCustomer(cid)[0]?.id).toBe(m.id);
  });

  test("a resource_missing detach error still removes the local row", async () => {
    const cid = makeCustomer("Delete Co 3");
    const m = saveMethod({
      customerId: cid,
      gatewayCustomerId: "cus_d3",
      gatewayMethodId: "pm_d3",
      last4: "0003",
    });
    stubDetach(async () => {
      const err: any = new Error("No such payment method");
      err.code = "resource_missing";
      throw err;
    });

    const result = await deleteMethod(m.id, cid);

    expect(result).toEqual({ success: true });
    expect(listMethodsForCustomer(cid)).toHaveLength(0);
  });

  test("deleting a method that belongs to a different customer fails and deletes nothing", async () => {
    const owner = makeCustomer("Delete Co 4 Owner");
    const stranger = makeCustomer("Delete Co 4 Stranger");
    const m = saveMethod({
      customerId: owner,
      gatewayCustomerId: "cus_d4",
      gatewayMethodId: "pm_d4",
      last4: "0004",
    });

    const result = await deleteMethod(m.id, stranger);

    expect(result).toEqual({ success: false, error: "Payment method not found" });
    expect(listMethodsForCustomer(owner)).toHaveLength(1);
  });

  test("deleting the default method promotes the oldest surviving method to default", async () => {
    const cid = makeCustomer("Delete Co 5");
    const first = saveMethod({
      customerId: cid,
      gatewayCustomerId: "cus_d5",
      gatewayMethodId: "pm_d5",
      last4: "0005",
    });
    const second = saveMethod({
      customerId: cid,
      gatewayCustomerId: "cus_d5",
      gatewayMethodId: "pm_d6",
      last4: "0006",
    });
    expect(first.is_default).toBe(1);
    stubDetach(async () => ({}));

    const result = await deleteMethod(first.id, cid);

    expect(result).toEqual({ success: true });
    expect(getDefaultMethod(cid)?.gateway_method_id).toBe(second.gateway_method_id);
  });

  test("deleting the last remaining method leaves no methods and no default", async () => {
    const cid = makeCustomer("Delete Co 6");
    const only = saveMethod({
      customerId: cid,
      gatewayCustomerId: "cus_d6",
      gatewayMethodId: "pm_d7",
      last4: "0007",
    });
    stubDetach(async () => ({}));

    const result = await deleteMethod(only.id, cid);

    expect(result).toEqual({ success: true });
    expect(listMethodsForCustomer(cid)).toHaveLength(0);
    expect(getDefaultMethod(cid)).toBeNull();
  });
});

describe("card capture from checkout", () => {
  afterEach(() => setStripeClientResolver(null));

  function mockStripe(overrides: Record<string, any> = {}) {
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: {
            retrieve: async () => ({
              id: "pi_capture",
              payment_method: "pm_captured",
              customer: "cus_captured",
            }),
          },
          paymentMethods: {
            retrieve: async () => ({
              id: "pm_captured",
              card: { brand: "mastercard", last4: "5555", exp_month: 4, exp_year: 2031 },
            }),
            detach: async () => ({}),
          },
          ...overrides,
        }) as any,
    );
  }

  test("a session without save_card saves nothing", async () => {
    mockStripe();
    const before = listMethodsForCustomer(customerId).length;
    await saveMethodFromCheckoutSession({
      payment_status: "paid",
      payment_intent: "pi_capture",
      metadata: { invoice_id: "inv_1", customer_id: customerId },
    } as any);
    expect(listMethodsForCustomer(customerId)).toHaveLength(before);
  });

  test("a session with save_card persists the method", async () => {
    mockStripe();
    await saveMethodFromCheckoutSession({
      payment_status: "paid",
      payment_intent: "pi_capture",
      metadata: {
        invoice_id: "inv_1",
        customer_id: customerId,
        save_card: "1",
        consent_text: "You authorise Acme to charge this card.",
      },
    } as any);
    const saved = listMethodsForCustomer(customerId).find(
      (m) => m.gateway_method_id === "pm_captured",
    );
    expect(saved).toBeTruthy();
    expect(saved!.brand).toBe("mastercard");
    expect(saved!.last4).toBe("5555");
    expect(saved!.gateway_customer_id).toBe("cus_captured");
    expect(saved!.consent_text).toBe("You authorise Acme to charge this card.");
  });

  test("an unpaid session saves nothing", async () => {
    mockStripe();
    const before = listMethodsForCustomer(customerId).length;
    await saveMethodFromCheckoutSession({
      payment_status: "unpaid",
      payment_intent: "pi_capture",
      metadata: { invoice_id: "inv_1", customer_id: customerId, save_card: "1" },
    } as any);
    expect(listMethodsForCustomer(customerId)).toHaveLength(before);
  });
});

import { chargeOffSession, classifyStripeError } from "../services/stripe.service";

describe("stripe error classification", () => {
  test("SCA is terminal, never retried", () => {
    expect(classifyStripeError("authentication_required")).toBe("requires_action");
  });

  test("hard declines are terminal", () => {
    for (const code of [
      "card_declined",
      "expired_card",
      "incorrect_number",
      "invalid_account",
      "card_velocity_exceeded",
    ]) {
      expect(classifyStripeError(code)).toBe("hard_failed");
    }
  });

  test("soft declines are retryable", () => {
    for (const code of [
      "insufficient_funds",
      "processing_error",
      "issuer_not_available",
      "try_again_later",
    ]) {
      expect(classifyStripeError(code)).toBe("soft_failed");
    }
  });

  test("an unrecognised code is treated as retryable", () => {
    expect(classifyStripeError("some_new_stripe_code")).toBe("soft_failed");
    expect(classifyStripeError(undefined)).toBe("soft_failed");
  });
});

describe("chargeOffSession", () => {
  afterEach(() => setStripeClientResolver(null));

  test("a succeeded intent returns its reference", async () => {
    const calls: any[] = [];
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: {
            create: async (params: any, opts: any) => {
              calls.push({ params, opts });
              return { id: "pi_ok", status: "succeeded" };
            },
          },
        }) as any,
    );

    const result = await chargeOffSession({
      invoiceId: "inv_ok",
      amount: 125.5,
      currency: "USD",
      gatewayCustomerId: "cus_1",
      gatewayMethodId: "pm_1",
      attemptNo: 1,
    });

    expect(result.status).toBe("succeeded");
    expect(result.reference).toBe("pi_ok");
    // Amount converted to minor units, off-session confirmed, idempotency keyed.
    expect(calls[0].params.amount).toBe(12550);
    expect(calls[0].params.currency).toBe("usd");
    expect(calls[0].params.off_session).toBe(true);
    expect(calls[0].params.confirm).toBe(true);
    expect(calls[0].opts.idempotencyKey).toBe("autobill:inv_ok:1");
  });

  test("a card error is classified rather than thrown", async () => {
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: {
            create: async () => {
              const err: any = new Error("Your card has insufficient funds.");
              err.type = "StripeCardError";
              err.code = "insufficient_funds";
              throw err;
            },
          },
        }) as any,
    );

    const result = await chargeOffSession({
      invoiceId: "inv_soft",
      amount: 10,
      currency: "USD",
      gatewayCustomerId: "cus_1",
      gatewayMethodId: "pm_1",
      attemptNo: 1,
    });

    expect(result.status).toBe("soft_failed");
    expect(result.errorCode).toBe("insufficient_funds");
  });

  test("SCA surfaces as requires_action", async () => {
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: {
            create: async () => {
              const err: any = new Error("Authentication required");
              err.type = "StripeCardError";
              err.code = "authentication_required";
              throw err;
            },
          },
        }) as any,
    );

    const result = await chargeOffSession({
      invoiceId: "inv_sca",
      amount: 10,
      currency: "USD",
      gatewayCustomerId: "cus_1",
      gatewayMethodId: "pm_1",
      attemptNo: 1,
    });

    expect(result.status).toBe("requires_action");
  });

  test("a resolver that cannot produce a client resolves soft_failed instead of throwing", async () => {
    setStripeClientResolver(async () => null);

    // No try/catch here on purpose: if chargeOffSession rejects instead of
    // resolving, this await throws inside the test body and bun:test fails
    // the test on the uncaught rejection, it does not pass silently.
    const result = await chargeOffSession({
      invoiceId: "inv_no_client",
      amount: 10,
      currency: "USD",
      gatewayCustomerId: "cus_1",
      gatewayMethodId: "pm_1",
      attemptNo: 1,
    });

    expect(result.status).toBe("soft_failed");
  });
});

import { attemptAutoBill } from "../services/auto-bill.service";
import { createInvoice, finaliseForSending, getInvoice } from "../services/invoice.service";

function attemptsFor(invoiceId: string) {
  return getDb()
    .query("SELECT * FROM auto_bill_attempts WHERE invoice_id = ? ORDER BY attempt_no ASC")
    .all(invoiceId) as any[];
}

function sentInvoiceFor(customer: string, amount: number) {
  const inv = createInvoice({
    customer_id: customer,
    issue_date: "2026-09-04",
    currency: "USD",
    items: [{ description: "Work", quantity: 1, unit_price: amount }],
  });
  finaliseForSending(inv.id);
  return getInvoice(inv.id)!;
}

describe("attemptAutoBill", () => {
  afterEach(() => setStripeClientResolver(null));

  test("skips a customer with no saved method", async () => {
    const bare = crypto.randomBytes(16).toString("hex");
    getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [bare, "Bare Co"]);
    const inv = sentInvoiceFor(bare, 50);

    const result = await attemptAutoBill(inv.id);
    expect(result.status).toBe("skipped");
    expect(attemptsFor(inv.id)).toHaveLength(0);
  });

  test("a successful charge records a payment and pays the invoice", async () => {
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: { create: async () => ({ id: "pi_paid_1", status: "succeeded" }) },
        }) as any,
    );
    const inv = sentInvoiceFor(customerId, 200);

    const result = await attemptAutoBill(inv.id);
    expect(result.status).toBe("succeeded");

    const after = getInvoice(inv.id)!;
    expect(after.status).toBe("paid");
    expect(after.amount_paid).toBe(200);

    const attempts = attemptsFor(inv.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("succeeded");
    expect(attempts[0].gateway_reference).toBe("pi_paid_1");
    expect(attempts[0].next_retry_at).toBeNull();
  });

  test("a soft decline schedules a retry", async () => {
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: {
            create: async () => {
              const e: any = new Error("insufficient funds");
              e.code = "insufficient_funds";
              throw e;
            },
          },
        }) as any,
    );
    const inv = sentInvoiceFor(customerId, 75);

    const result = await attemptAutoBill(inv.id);
    expect(result.status).toBe("soft_failed");

    const attempts = attemptsFor(inv.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].next_retry_at).toBeTruthy();
    expect(getInvoice(inv.id)!.status).toBe("sent");
  });

  test("the final soft decline is terminal", async () => {
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: {
            create: async () => {
              const e: any = new Error("insufficient funds");
              e.code = "insufficient_funds";
              throw e;
            },
          },
        }) as any,
    );
    const inv = sentInvoiceFor(customerId, 80);

    await attemptAutoBill(inv.id, { attemptNo: 1 });
    await attemptAutoBill(inv.id, { attemptNo: 2 });
    await attemptAutoBill(inv.id, { attemptNo: 3 });

    const attempts = attemptsFor(inv.id);
    expect(attempts).toHaveLength(3);
    expect(attempts[2].next_retry_at).toBeNull();
  });

  test("a hard decline is terminal on the first attempt", async () => {
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: {
            create: async () => {
              const e: any = new Error("card declined");
              e.code = "card_declined";
              throw e;
            },
          },
        }) as any,
    );
    const inv = sentInvoiceFor(customerId, 90);

    const result = await attemptAutoBill(inv.id);
    expect(result.status).toBe("hard_failed");
    expect(attemptsFor(inv.id)[0].next_retry_at).toBeNull();
  });

  test("SCA is terminal on the first attempt", async () => {
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: {
            create: async () => {
              const e: any = new Error("authentication required");
              e.code = "authentication_required";
              throw e;
            },
          },
        }) as any,
    );
    const inv = sentInvoiceFor(customerId, 95);

    const result = await attemptAutoBill(inv.id);
    expect(result.status).toBe("requires_action");
    expect(attemptsFor(inv.id)[0].next_retry_at).toBeNull();
  });

  test("two ticks in the same window charge exactly once", async () => {
    let created = 0;
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: {
            create: async () => {
              created++;
              return { id: "pi_once", status: "succeeded" };
            },
          },
        }) as any,
    );
    const inv = sentInvoiceFor(customerId, 60);

    await attemptAutoBill(inv.id, { attemptNo: 1 });
    await attemptAutoBill(inv.id, { attemptNo: 1 });

    expect(created).toBe(1);
    expect(attemptsFor(inv.id)).toHaveLength(1);
    const payments = getDb()
      .query("SELECT * FROM payments WHERE invoice_id = ?")
      .all(inv.id) as any[];
    expect(payments).toHaveLength(1);
  });

  test("skips an invoice with no balance due", async () => {
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: { create: async () => ({ id: "pi_nope", status: "succeeded" }) },
        }) as any,
    );
    const inv = sentInvoiceFor(customerId, 40);
    await attemptAutoBill(inv.id);

    const second = await attemptAutoBill(inv.id, { attemptNo: 2 });
    expect(second.status).toBe("skipped");
  });
});
