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
