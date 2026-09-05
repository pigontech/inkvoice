import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
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

import { listActivity } from "../services/activity.service";
import { attemptAutoBill } from "../services/auto-bill.service";
import { createInvoice, finaliseForSending, getInvoice } from "../services/invoice.service";
import { recordPayment } from "../services/payment.service";
import { updateSettings } from "../services/settings.service";

function attemptsFor(invoiceId: string) {
  return getDb()
    .query("SELECT * FROM auto_bill_attempts WHERE invoice_id = ? ORDER BY attempt_no ASC")
    .all(invoiceId) as any[];
}

function paymentsFor(invoiceId: string) {
  return getDb().query("SELECT * FROM payments WHERE invoice_id = ?").all(invoiceId) as any[];
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
  // attemptAutoBill now gates on isGatewayEnabled (finding 1), the same kill
  // switch the public pay endpoint already honours. Every test below expects
  // stripe to be usable unless it explicitly disables it, so make that the
  // default for every test in this describe. This has to be beforeEach, not
  // beforeAll: bun:test runs every describe's beforeAll upfront, in file
  // order, before any test in the file runs, so a beforeAll here would still
  // be clobbered by the "stripe client resolution" describe's own afterEach
  // (which resets the configured checker to null) once that describe's tests
  // actually execute, later in the run.
  beforeEach(() => {
    setStripeConfiguredChecker(() => true);
    updateSettings({ stripe_enabled: "true" });
  });
  afterAll(() => setStripeConfiguredChecker(null));
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

  test("two concurrent ticks in the same window charge exactly once", async () => {
    // A faithful stand in for Stripe's real idempotency guarantee: the same
    // idempotency key always returns the same PaymentIntent instead of
    // minting a new one. Without this the mock itself would create two
    // separate charges, which is not the scenario under test, two of OUR
    // ticks racing for the SAME underlying charge.
    let created = 0;
    const byIdempotencyKey = new Map<string, { id: string; status: string }>();
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: {
            create: async (_params: any, opts: any) => {
              const key = opts?.idempotencyKey;
              const cached = key ? byIdempotencyKey.get(key) : undefined;
              if (cached) return cached;
              created++;
              const intent = { id: "pi_concurrent", status: "succeeded" };
              if (key) byIdempotencyKey.set(key, intent);
              return intent;
            },
          },
        }) as any,
    );
    const inv = sentInvoiceFor(customerId, 60);

    // Genuinely concurrent: both calls pass every precondition before either
    // one writes anything, this is the real double-collection window, not a
    // sequential call where the second is skipped before it starts. No
    // try/catch on purpose: if either call rejects, this await throws and
    // bun:test fails the test, it does not pass silently.
    const results = await Promise.all([
      attemptAutoBill(inv.id, { attemptNo: 1 }),
      attemptAutoBill(inv.id, { attemptNo: 1 }),
    ]);

    expect(results.every((r) => r.status === "succeeded")).toBe(true);
    expect(created).toBe(1);
    expect(attemptsFor(inv.id)).toHaveLength(1);
    expect(paymentsFor(inv.id)).toHaveLength(1);
  });

  test("skips an invoice with no balance due", async () => {
    const inv = sentInvoiceFor(customerId, 40);
    // Force a settled balance without going through recordPayment, which
    // would also flip the status to paid and let the earlier
    // invoice_status_paid guard catch it first instead of no_balance_due.
    getDb().run("UPDATE invoices SET amount_paid = ? WHERE id = ?", [40, inv.id]);

    const result = await attemptAutoBill(inv.id);
    expect(result.status).toBe("skipped");
    expect((result as any).errorCode).toBe("no_balance_due");
  });

  test("a charge that lands after the invoice was settled elsewhere is not recorded again", async () => {
    const inv = sentInvoiceFor(customerId, 70);
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: {
            create: async () => {
              // Simulate the customer paying through the public invoice page
              // while this off session charge is in flight at the gateway.
              recordPayment(inv.id, {
                amount: 70,
                payment_date: "2026-09-04",
                method: "bank_transfer",
                reference: "other_channel_1",
              });
              return { id: "pi_race", status: "succeeded" };
            },
          },
        }) as any,
    );

    const result = await attemptAutoBill(inv.id);
    expect(result.status).toBe("succeeded");

    // Only the other channel's payment exists, the auto-bill charge is not
    // also recorded on top of it even though the card was actually charged.
    const payments = paymentsFor(inv.id);
    expect(payments).toHaveLength(1);
    expect(payments[0].reference).toBe("other_channel_1");
    expect(getInvoice(inv.id)!.amount_paid).toBe(70);

    const activity = listActivity({
      resource_type: "invoice",
      action: "auto_bill_failed",
      page: 1,
      limit: 50,
    });
    expect(activity.items.some((a) => a.resource_id === inv.id)).toBe(true);
  });

  test("a recordPayment duplicate reference from a concurrent tick does not throw", async () => {
    const inv = sentInvoiceFor(customerId, 65);
    // Pre seed a payment row as if a concurrent tick already recorded this
    // exact gateway reference for this invoice, without going through
    // recordPayment so the invoice status and balance stay untouched.
    getDb().run(
      "INSERT INTO payments (id, invoice_id, amount, payment_date, method, reference) VALUES (?, ?, ?, ?, ?, ?)",
      [crypto.randomBytes(16).toString("hex"), inv.id, 65, "2026-09-04", "card", "pi_dup"],
    );
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: { create: async () => ({ id: "pi_dup", status: "succeeded" }) },
        }) as any,
    );

    const result = await attemptAutoBill(inv.id);
    expect(result.status).toBe("succeeded");
    // No throw, and no second payment row from the duplicate insert attempt.
    expect(paymentsFor(inv.id)).toHaveLength(1);
  });

  test("a captured charge that recordPayment refuses still notifies the admin", async () => {
    const inv = sentInvoiceFor(customerId, 55);
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: {
            create: async () => {
              // Simulate the invoice being voided by another actor while the
              // charge is in flight, recordPayment will refuse a voided
              // invoice, but the card has already been charged by then.
              getDb().run("UPDATE invoices SET status = 'voided' WHERE id = ?", [inv.id]);
              return { id: "pi_voided_race", status: "succeeded" };
            },
          },
        }) as any,
    );

    const result = await attemptAutoBill(inv.id);
    expect(result.status).toBe("succeeded");
    expect(paymentsFor(inv.id)).toHaveLength(0);

    const activity = listActivity({
      resource_type: "invoice",
      action: "auto_bill_failed",
      page: 1,
      limit: 50,
    });
    const entry = activity.items.find((a) => a.resource_id === inv.id);
    expect(entry).toBeTruthy();
    expect(JSON.parse(entry!.metadata!).reason).toContain("captured");
  });

  // Finding 1: turning Stripe off in Settings is the merchant's kill switch
  // for the public Pay button, and it must stop off-session charging too, not
  // just voluntary payments.
  test("stripe disabled in Settings makes zero gateway calls and skips", async () => {
    let gatewayCalls = 0;
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: {
            create: async () => {
              gatewayCalls++;
              return { id: "pi_should_never_happen", status: "succeeded" };
            },
          },
        }) as any,
    );
    updateSettings({ stripe_enabled: "false" });

    try {
      const inv = sentInvoiceFor(customerId, 33);
      const result = await attemptAutoBill(inv.id);

      expect(result.status).toBe("skipped");
      expect((result as any).errorCode).toBe("gateway_disabled");
      expect(gatewayCalls).toBe(0);
      expect(attemptsFor(inv.id)).toHaveLength(0);
    } finally {
      updateSettings({ stripe_enabled: "true" });
    }
  });

  // Finding 2: a skip that means "we could not bill this" (no saved card,
  // gateway cannot auto-bill, gateway disabled) must behave like a terminal
  // failure for delivery and notification, exactly like no_balance_due and
  // invoice_status_* must NOT: there is nothing owed there, so those stay silent.
  test("a customer with no saved card gets exactly one payment-link email and the admin is notified", async () => {
    const bare = crypto.randomBytes(16).toString("hex");
    getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [bare, "No Card Notify Co"]);
    const inv = sentInvoiceFor(bare, 42);

    const emailCalls: string[] = [];
    const realSend = await import("../services/invoice-send.service");
    mock.module("../services/invoice-send.service", () => ({
      ...realSend,
      sendInvoiceEmail: async (invoiceId: string) => {
        emailCalls.push(invoiceId);
        return { success: true };
      },
    }));

    try {
      const result = await attemptAutoBill(inv.id);
      expect(result.status).toBe("skipped");
      expect((result as any).errorCode).toBe("no_saved_method");
      // Exactly one customer email, the payment link.
      expect(emailCalls).toEqual([inv.id]);
      expect(result.emailedPaymentLink).toBe(true);

      // An admin notification (the in-app bell / webhook path notifyFailure
      // always fires) was recorded for this invoice.
      const activity = listActivity({
        resource_type: "invoice",
        action: "auto_bill_failed",
        page: 1,
        limit: 50,
      });
      expect(activity.items.some((a) => a.resource_id === inv.id)).toBe(true);
    } finally {
      mock.module("../services/invoice-send.service", () => realSend);
    }
  });

  test("no_balance_due and invoice_status_* skips stay silent, unlike no_saved_method", async () => {
    const emailCalls: string[] = [];
    const realSend = await import("../services/invoice-send.service");
    mock.module("../services/invoice-send.service", () => ({
      ...realSend,
      sendInvoiceEmail: async (invoiceId: string) => {
        emailCalls.push(invoiceId);
        return { success: true };
      },
    }));

    try {
      const inv = sentInvoiceFor(customerId, 40);
      getDb().run("UPDATE invoices SET amount_paid = ? WHERE id = ?", [40, inv.id]);

      const result = await attemptAutoBill(inv.id);
      expect(result.status).toBe("skipped");
      expect((result as any).errorCode).toBe("no_balance_due");
      expect(result.emailedPaymentLink).toBe(false);
      expect(emailCalls).toHaveLength(0);
    } finally {
      mock.module("../services/invoice-send.service", () => realSend);
    }
  });

  // Finding 3: the fallback payment-link email must never be reported as sent
  // when it was not. sendInvoiceEmail returning {success:false} (the normal
  // outcome for "email not configured", not a thrown error) must flip
  // emailedPaymentLink to false and must stop the admin notification from
  // claiming the customer was emailed.
  test("when the payment-link email fails, emailedPaymentLink is false and the admin is told the truth", async () => {
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

    const realSend = await import("../services/invoice-send.service");
    mock.module("../services/invoice-send.service", () => ({
      ...realSend,
      sendInvoiceEmail: async () => ({
        success: false,
        error: "SMTP is not configured",
        status: 400,
      }),
    }));

    const realEmail = await import("../services/email.service");
    const adminEmails: { text: string; html: string }[] = [];
    mock.module("../services/email.service", () => ({
      ...realEmail,
      isEmailConfigured: async () => true,
      sendEmail: async (opts: { text: string; html: string }) => {
        adminEmails.push({ text: opts.text, html: opts.html });
        return { success: true };
      },
    }));
    updateSettings({ notify_on_auto_bill_failure: "true", company_email: "owner@example.test" });

    try {
      const inv = sentInvoiceFor(customerId, 88);
      const result = await attemptAutoBill(inv.id);

      expect(result.status).toBe("hard_failed");
      // The email genuinely failed, this must not read true.
      expect(result.emailedPaymentLink).toBe(false);

      expect(adminEmails).toHaveLength(1);
      expect(adminEmails[0].text).not.toContain("has been emailed a payment link");
      expect(adminEmails[0].text).toContain("could NOT be emailed a payment link");
    } finally {
      mock.module("../services/invoice-send.service", () => realSend);
      mock.module("../services/email.service", () => realEmail);
      updateSettings({ notify_on_auto_bill_failure: "false" });
    }
  });
});

import { processAutoBillRetries } from "../services/auto-bill.service";

describe("processAutoBillRetries", () => {
  // Same reasoning as the "attemptAutoBill" describe above (beforeEach, not
  // beforeAll, because of how bun:test schedules beforeAll across describes):
  // keep stripe usable by default so a retried charge is not skipped as
  // gateway_disabled.
  beforeEach(() => {
    setStripeConfiguredChecker(() => true);
    updateSettings({ stripe_enabled: "true" });
  });
  afterAll(() => setStripeConfiguredChecker(null));
  afterEach(() => setStripeClientResolver(null));

  test("retries only attempts whose next_retry_at has passed", async () => {
    let created = 0;
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: {
            create: async () => {
              created++;
              return { id: `pi_retry_${created}`, status: "succeeded" };
            },
          },
        }) as any,
    );

    const due = sentInvoiceFor(customerId, 30);
    const notDue = sentInvoiceFor(customerId, 30);
    const past = new Date(Date.now() - 3600_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();

    for (const [inv, when] of [
      [due, past],
      [notDue, future],
    ] as const) {
      getDb().run(
        `INSERT INTO auto_bill_attempts
           (id, invoice_id, attempt_no, status, error_code, next_retry_at)
         VALUES (?, ?, 1, 'soft_failed', 'insufficient_funds', ?)`,
        [crypto.randomBytes(16).toString("hex"), inv.id, when],
      );
    }

    const result = await processAutoBillRetries();
    expect(result.retried).toBe(1);
    expect(getInvoice(due.id)!.status).toBe("paid");
    expect(getInvoice(notDue.id)!.status).toBe("sent");
  });

  test("a retried attempt is no longer due", async () => {
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: { create: async () => ({ id: "pi_settled", status: "succeeded" }) },
        }) as any,
    );

    const inv = sentInvoiceFor(customerId, 45);
    getDb().run(
      `INSERT INTO auto_bill_attempts
         (id, invoice_id, attempt_no, status, error_code, next_retry_at)
       VALUES (?, ?, 1, 'soft_failed', 'insufficient_funds', ?)`,
      [
        crypto.randomBytes(16).toString("hex"),
        inv.id,
        new Date(Date.now() - 3600_000).toISOString(),
      ],
    );

    await processAutoBillRetries();
    const second = await processAutoBillRetries();
    expect(second.retried).toBe(0);
  });
});

import { createApp } from "../app";

describe("portal payment methods", () => {
  let app: ReturnType<typeof createApp>;
  let portalToken: string;
  let portalCustomer: string;

  beforeAll(() => {
    app = createApp();
    portalCustomer = crypto.randomBytes(16).toString("hex");
    portalToken = crypto.randomBytes(16).toString("hex");
    getDb().run("INSERT INTO customers (id, name, portal_enabled) VALUES (?, ?, 1)", [
      portalCustomer,
      "Portal Co",
    ]);
    getDb().run("INSERT INTO portal_tokens (customer_id, token) VALUES (?, ?)", [
      portalCustomer,
      portalToken,
    ]);
  });

  test("lists only safe display fields", async () => {
    saveMethod({
      customerId: portalCustomer,
      gatewayCustomerId: "cus_portal",
      gatewayMethodId: "pm_portal",
      brand: "visa",
      last4: "4242",
      expMonth: 6,
      expYear: 2032,
    });

    const res = await app.request(`/api/v1/public/portal/${portalToken}/payment-methods`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].last4).toBe("4242");
    expect(body.data[0].brand).toBe("visa");
    // Gateway identifiers must never reach the browser.
    expect(body.data[0].gateway_method_id).toBeUndefined();
    expect(body.data[0].gateway_customer_id).toBeUndefined();
  });

  test("rejects an unknown portal token", async () => {
    const res = await app.request("/api/v1/public/portal/not-a-token/payment-methods");
    expect(res.status).toBe(404);
  });

  test("a detach failure keeps the row", async () => {
    setStripeClientResolver(
      async () =>
        ({
          paymentMethods: {
            detach: async () => {
              throw new Error("stripe is down");
            },
          },
        }) as any,
    );

    const listed = await (
      await app.request(`/api/v1/public/portal/${portalToken}/payment-methods`)
    ).json();
    const id = listed.data[0].id;

    const res = await app.request(`/api/v1/public/portal/${portalToken}/payment-methods/${id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(502);

    const still = await (
      await app.request(`/api/v1/public/portal/${portalToken}/payment-methods`)
    ).json();
    expect(still.data).toHaveLength(1);

    setStripeClientResolver(null);
  });

  test("a successful detach removes the row", async () => {
    setStripeClientResolver(
      async () =>
        ({
          paymentMethods: { detach: async () => ({}) },
        }) as any,
    );

    const listed = await (
      await app.request(`/api/v1/public/portal/${portalToken}/payment-methods`)
    ).json();
    const id = listed.data[0].id;

    const res = await app.request(`/api/v1/public/portal/${portalToken}/payment-methods/${id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const after = await (
      await app.request(`/api/v1/public/portal/${portalToken}/payment-methods`)
    ).json();
    expect(after.data).toHaveLength(0);

    setStripeClientResolver(null);
  });

  test("one customer cannot delete another customer's payment method", async () => {
    const otherCustomer = crypto.randomBytes(16).toString("hex");
    const otherToken = crypto.randomBytes(16).toString("hex");
    getDb().run("INSERT INTO customers (id, name, portal_enabled) VALUES (?, ?, 1)", [
      otherCustomer,
      "Other Portal Co",
    ]);
    getDb().run("INSERT INTO portal_tokens (customer_id, token) VALUES (?, ?)", [
      otherCustomer,
      otherToken,
    ]);

    const otherMethod = saveMethod({
      customerId: otherCustomer,
      gatewayCustomerId: "cus_other",
      gatewayMethodId: "pm_other",
      brand: "mastercard",
      last4: "5555",
      expMonth: 12,
      expYear: 2032,
    });

    // Mock a successful detach so the row surviving actually proves the
    // ownership check ran, rather than proving Stripe was unreachable.
    let detachCalls = 0;
    setStripeClientResolver(
      async () =>
        ({
          paymentMethods: {
            detach: async () => {
              detachCalls++;
              return {};
            },
          },
        }) as any,
    );

    const res = await app.request(
      `/api/v1/public/portal/${portalToken}/payment-methods/${otherMethod.id}`,
      { method: "DELETE" },
    );

    // Check the ownership-check evidence first (row survives, detach never
    // reached) so a broken ownership check is caught here, not masked by the
    // status assertion happening to fail on its own for an unrelated reason.
    const stillExists = listMethodsForCustomer(otherCustomer);
    expect(stillExists).toHaveLength(1);
    expect(stillExists[0].id).toBe(otherMethod.id);
    expect(detachCalls).toBe(0);
    expect(res.status).toBe(404);

    setStripeClientResolver(null);
  });

  test("one customer's list does not include another customer's payment methods", async () => {
    const anotherCustomer = crypto.randomBytes(16).toString("hex");
    const anotherToken = crypto.randomBytes(16).toString("hex");
    getDb().run("INSERT INTO customers (id, name, portal_enabled) VALUES (?, ?, 1)", [
      anotherCustomer,
      "Another Portal Co",
    ]);
    getDb().run("INSERT INTO portal_tokens (customer_id, token) VALUES (?, ?)", [
      anotherCustomer,
      anotherToken,
    ]);

    saveMethod({
      customerId: anotherCustomer,
      gatewayCustomerId: "cus_another",
      gatewayMethodId: "pm_another",
      brand: "amex",
      last4: "7777",
      expMonth: 6,
      expYear: 2031,
    });

    const portalList = await (
      await app.request(`/api/v1/public/portal/${portalToken}/payment-methods`)
    ).json();

    expect(portalList.data).toBeDefined();
    for (const method of portalList.data) {
      expect(method.last4).not.toBe("7777");
    }
  });
});

describe("admin customer payment-methods routes", () => {
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let adminCustomerId: string;

  async function authed(path: string, opts: RequestInit = {}) {
    const headers: Record<string, string> = {
      ...((opts.headers as Record<string, string>) || {}),
      Authorization: `Bearer ${adminToken}`,
    };
    if (opts.method && opts.method !== "GET") headers["Content-Type"] = "application/json";
    return app.request(new Request(`http://localhost${path}`, { ...opts, headers }));
  }

  beforeAll(async () => {
    app = createApp();
    const res = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "autobilltestpass" }),
    });
    const data = (await res.json()) as any;
    adminToken = data.data.token;

    adminCustomerId = crypto.randomBytes(16).toString("hex");
    getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [
      adminCustomerId,
      "Admin View Co",
    ]);
  });

  afterEach(() => setStripeClientResolver(null));

  test("rejects an unauthenticated request", async () => {
    const res = await app.request(`/api/v1/customers/${adminCustomerId}/payment-methods`);
    expect(res.status).toBe(401);
  });

  test("returns 404 for a customer that does not exist", async () => {
    const res = await authed(`/api/v1/customers/does-not-exist/payment-methods`);
    expect(res.status).toBe(404);
  });

  test("lists only safe display fields, gateway identifiers are not exposed", async () => {
    saveMethod({
      customerId: adminCustomerId,
      gatewayCustomerId: "cus_admin_view",
      gatewayMethodId: "pm_admin_view",
      brand: "visa",
      last4: "4242",
      expMonth: 3,
      expYear: 2030,
    });

    const res = await authed(`/api/v1/customers/${adminCustomerId}/payment-methods`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].last4).toBe("4242");
    expect(body.data[0].brand).toBe("visa");
    expect(body.data[0].gateway_method_id).toBeUndefined();
    expect(body.data[0].gateway_customer_id).toBeUndefined();
  });

  test("deleting an unknown payment method returns 404", async () => {
    const res = await authed(`/api/v1/customers/${adminCustomerId}/payment-methods/not-a-real-id`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  test("a gateway detach failure returns 502, distinct from the 404 not-found mapping", async () => {
    const m = saveMethod({
      customerId: adminCustomerId,
      gatewayCustomerId: "cus_admin_502",
      gatewayMethodId: "pm_admin_502",
      brand: "mastercard",
      last4: "5555",
    });
    setStripeClientResolver(
      async () =>
        ({
          paymentMethods: {
            detach: async () => {
              throw new Error("stripe is down");
            },
          },
        }) as any,
    );

    const res = await authed(`/api/v1/customers/${adminCustomerId}/payment-methods/${m.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(502);

    const stillListed = await (
      await authed(`/api/v1/customers/${adminCustomerId}/payment-methods`)
    ).json();
    expect(stillListed.data.some((x: any) => x.id === m.id)).toBe(true);
  });

  test("a successful delete removes the method and the customer's list empties", async () => {
    const cid = crypto.randomBytes(16).toString("hex");
    getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [cid, "Admin Delete Co"]);
    const m = saveMethod({
      customerId: cid,
      gatewayCustomerId: "cus_admin_del",
      gatewayMethodId: "pm_admin_del",
      brand: "visa",
      last4: "0009",
    });
    setStripeClientResolver(async () => ({ paymentMethods: { detach: async () => ({}) } }) as any);

    const res = await authed(`/api/v1/customers/${cid}/payment-methods/${m.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const after = await (await authed(`/api/v1/customers/${cid}/payment-methods`)).json();
    expect(after.data).toHaveLength(0);
  });

  test("one customer cannot delete another customer's payment method via the admin route", async () => {
    const owner = crypto.randomBytes(16).toString("hex");
    getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [owner, "Admin Owner Co"]);
    const m = saveMethod({
      customerId: owner,
      gatewayCustomerId: "cus_admin_owner",
      gatewayMethodId: "pm_admin_owner",
      brand: "visa",
      last4: "0010",
    });

    let detachCalls = 0;
    setStripeClientResolver(
      async () =>
        ({
          paymentMethods: {
            detach: async () => {
              detachCalls++;
              return {};
            },
          },
        }) as any,
    );

    // adminCustomerId does not own this method, so the delete must 404 without
    // ever reaching the gateway, regardless of who is asking.
    const res = await authed(`/api/v1/customers/${adminCustomerId}/payment-methods/${m.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    expect(detachCalls).toBe(0);
    expect(listMethodsForCustomer(owner)).toHaveLength(1);
  });
});
