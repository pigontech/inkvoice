import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import crypto from "node:crypto";
import { unlinkSync } from "node:fs";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { saveMethod } from "../services/customer-payment-method.service";
import { createInvoice, getInvoice } from "../services/invoice.service";
import { createRecurring, generateInvoice, processAllDue } from "../services/recurring.service";
import { setStripeClientResolver } from "../services/stripe.service";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-recurring-cron.db";
let customerId: string;

function todayMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "recurringcrontestpass";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  resetEnvCache();

  initDatabase();
  runMigrations();
  await seed();

  customerId = crypto.randomBytes(16).toString("hex");
  getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [customerId, "Recurring Co"]);
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

function makeTemplateInvoice(): string {
  const inv = createInvoice({
    customer_id: customerId,
    issue_date: todayMinus(30),
    due_date: todayMinus(15),
    items: [{ description: "Subscription", quantity: 1, unit_price: 100, tax_rate: 0 }],
  });
  return inv.id;
}

function makeCustomer(name: string): string {
  const id = crypto.randomBytes(16).toString("hex");
  getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [id, name]);
  return id;
}

describe("recurring invoice scheduler", () => {
  test("generateInvoice materializes a new invoice and advances next_run_date", async () => {
    const templateId = makeTemplateInvoice();
    const schedule = createRecurring({
      customer_id: customerId,
      template_invoice_id: templateId,
      frequency: "monthly",
      interval_value: 1,
      next_run_date: todayMinus(1), // due yesterday
    });

    const startCount = (
      getDb().query("SELECT COUNT(*) as c FROM invoices WHERE customer_id = ?").get(customerId) as {
        c: number;
      }
    ).c;

    const newInvoiceId = await generateInvoice(schedule.id);
    expect(newInvoiceId).not.toBeNull();

    const endCount = (
      getDb().query("SELECT COUNT(*) as c FROM invoices WHERE customer_id = ?").get(customerId) as {
        c: number;
      }
    ).c;
    expect(endCount).toBe(startCount + 1);

    const after = getDb()
      .query("SELECT next_run_date, total_generated FROM recurring_invoices WHERE id = ?")
      .get(schedule.id) as { next_run_date: string; total_generated: number };
    expect(after.total_generated).toBe(1);
    // next_run_date should now be ~1 month after the prior next_run_date.
    expect(new Date(after.next_run_date).getTime()).toBeGreaterThan(Date.now());
  });

  test("processAllDue fires for active schedules whose next_run_date is past", async () => {
    const templateId = makeTemplateInvoice();
    const sch1 = createRecurring({
      customer_id: customerId,
      template_invoice_id: templateId,
      frequency: "weekly",
      interval_value: 1,
      next_run_date: todayMinus(2),
    });
    const sch2 = createRecurring({
      customer_id: customerId,
      template_invoice_id: templateId,
      frequency: "weekly",
      interval_value: 1,
      next_run_date: todayMinus(7),
    });
    // Future schedule shouldn't fire
    const sch3 = createRecurring({
      customer_id: customerId,
      template_invoice_id: templateId,
      frequency: "monthly",
      interval_value: 1,
      next_run_date: (() => {
        const d = new Date();
        d.setDate(d.getDate() + 14);
        return d.toISOString().split("T")[0];
      })(),
    });

    const result = await processAllDue();
    expect(result.generated).toBeGreaterThanOrEqual(2);

    // sch1 + sch2 advanced; sch3 untouched
    const s3 = getDb()
      .query("SELECT total_generated FROM recurring_invoices WHERE id = ?")
      .get(sch3.id) as { total_generated: number };
    expect(s3.total_generated).toBe(0);

    const s1 = getDb()
      .query("SELECT total_generated FROM recurring_invoices WHERE id = ?")
      .get(sch1.id) as { total_generated: number };
    const s2 = getDb()
      .query("SELECT total_generated FROM recurring_invoices WHERE id = ?")
      .get(sch2.id) as { total_generated: number };
    expect(s1.total_generated).toBeGreaterThanOrEqual(1);
    expect(s2.total_generated).toBeGreaterThanOrEqual(1);
  });

  test("schedule transitions to completed when next_run_date passes end_date", async () => {
    const templateId = makeTemplateInvoice();
    // Set end_date in the past so any advance will mark it completed
    const schedule = createRecurring({
      customer_id: customerId,
      template_invoice_id: templateId,
      frequency: "monthly",
      interval_value: 1,
      next_run_date: todayMinus(1),
      end_date: todayMinus(5),
    });

    await generateInvoice(schedule.id);
    const after = getDb()
      .query("SELECT status FROM recurring_invoices WHERE id = ?")
      .get(schedule.id) as { status: string };
    expect(after.status).toBe("completed");
  });

  test("paused schedule does not generate", async () => {
    const templateId = makeTemplateInvoice();
    const schedule = createRecurring({
      customer_id: customerId,
      template_invoice_id: templateId,
      frequency: "monthly",
      interval_value: 1,
      next_run_date: todayMinus(1),
    });
    getDb().run("UPDATE recurring_invoices SET status = 'paused' WHERE id = ?", [schedule.id]);
    const result = await generateInvoice(schedule.id);
    expect(result).toBeNull();
  });
});

describe("finalisation on generation", () => {
  test("a default profile still generates a draft", async () => {
    const template = createInvoice({
      customer_id: customerId,
      issue_date: todayMinus(30),
      currency: "USD",
      items: [{ description: "Retainer", quantity: 1, unit_price: 500 }],
    });
    const rec = createRecurring({
      customer_id: customerId,
      template_invoice_id: template.id,
      frequency: "monthly",
      next_run_date: todayMinus(1),
    });

    const invoiceId = await generateInvoice(rec.id);
    expect(invoiceId).toBeTruthy();
    const generated = getInvoice(invoiceId!)!;
    expect(generated.status).toBe("draft");
    expect(generated.share_token).toBeNull();
  });

  test("an auto_send profile generates a finalised, share-linked invoice", async () => {
    const template = createInvoice({
      customer_id: customerId,
      issue_date: todayMinus(30),
      currency: "USD",
      items: [{ description: "Retainer", quantity: 1, unit_price: 500 }],
    });
    const rec = createRecurring({
      customer_id: customerId,
      template_invoice_id: template.id,
      frequency: "monthly",
      next_run_date: todayMinus(1),
      auto_send: true,
    });

    const invoiceId = await generateInvoice(rec.id);
    const generated = getInvoice(invoiceId!)!;
    expect(generated.status).toBe("sent");
    expect(generated.is_published).toBe(1);
    expect(generated.share_token).toBeTruthy();
  });

  test("an email failure still leaves the invoice generated", async () => {
    // Email is unconfigured in this suite, so sendInvoiceEmail returns
    // {success:false, status:400}. Generation must survive it.
    const template = createInvoice({
      customer_id: customerId,
      issue_date: todayMinus(30),
      currency: "USD",
      items: [{ description: "Retainer", quantity: 1, unit_price: 500 }],
    });
    const rec = createRecurring({
      customer_id: customerId,
      template_invoice_id: template.id,
      frequency: "monthly",
      next_run_date: todayMinus(1),
      auto_send: true,
    });

    const invoiceId = await generateInvoice(rec.id);
    expect(invoiceId).toBeTruthy();
    expect(getInvoice(invoiceId!)!.status).toBe("sent");
  });

  test("an auto_bill profile charges the saved card on generation", async () => {
    setStripeClientResolver(
      async () =>
        ({
          paymentIntents: { create: async () => ({ id: "pi_recurring", status: "succeeded" }) },
        }) as any,
    );
    saveMethod({
      customerId,
      gatewayCustomerId: "cus_rec",
      gatewayMethodId: "pm_rec",
      last4: "4242",
    });

    const template = createInvoice({
      customer_id: customerId,
      issue_date: todayMinus(30),
      currency: "USD",
      items: [{ description: "Retainer", quantity: 1, unit_price: 300 }],
    });
    const rec = createRecurring({
      customer_id: customerId,
      template_invoice_id: template.id,
      frequency: "monthly",
      next_run_date: todayMinus(1),
      auto_bill: true,
    });

    const invoiceId = await generateInvoice(rec.id);
    const generated = getInvoice(invoiceId!)!;
    expect(generated.status).toBe("paid");
    expect(generated.amount_paid).toBe(300);

    setStripeClientResolver(null);
  });
});

describe("auto_bill and auto_send together", () => {
  // recurring.service imports sendInvoiceEmail from invoice-send.service with a
  // static top-level import, and calls it directly (not through a namespace
  // object). Bun's mock.module hot-swaps that live binding in place, so a
  // plain mock.module call before invoking generateInvoice is enough, no
  // dynamic re-import is required here. We still capture the original
  // function values up front (before any mock.module call touches the
  // module's exports) so we can restore the exact real implementation
  // afterwards, since other tests in this file rely on the real,
  // unconfigured-email behaviour of sendInvoiceEmail.
  async function withMockedSendInvoiceEmail<T>(
    stub: (invoiceId: string) => Promise<{ success: boolean }>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const real = await import("../services/invoice-send.service");
    const originalSendInvoiceEmail = real.sendInvoiceEmail;
    const originalResolvePublicOrigin = real.resolvePublicOrigin;

    mock.module("../services/invoice-send.service", () => ({
      sendInvoiceEmail: stub,
      resolvePublicOrigin: originalResolvePublicOrigin,
    }));

    try {
      return await fn();
    } finally {
      mock.module("../services/invoice-send.service", () => ({
        sendInvoiceEmail: originalSendInvoiceEmail,
        resolvePublicOrigin: originalResolvePublicOrigin,
      }));
    }
  }

  test("a successful charge on a profile with both flags on leaves the invoice paid and sends no email", async () => {
    const calls: string[] = [];

    await withMockedSendInvoiceEmail(
      async (invoiceId: string) => {
        calls.push(invoiceId);
        return { success: true };
      },
      async () => {
        setStripeClientResolver(
          async () =>
            ({
              paymentIntents: {
                create: async () => ({ id: "pi_both_succeed", status: "succeeded" }),
              },
            }) as any,
        );

        try {
          const custId = makeCustomer("Both Flags, Charge Succeeds");
          saveMethod({
            customerId: custId,
            gatewayCustomerId: "cus_both_succeed",
            gatewayMethodId: "pm_both_succeed",
            last4: "4242",
          });

          const template = createInvoice({
            customer_id: custId,
            issue_date: todayMinus(30),
            currency: "USD",
            items: [{ description: "Retainer", quantity: 1, unit_price: 400 }],
          });
          const rec = createRecurring({
            customer_id: custId,
            template_invoice_id: template.id,
            frequency: "monthly",
            next_run_date: todayMinus(1),
            auto_send: true,
            auto_bill: true,
          });

          const invoiceId = await generateInvoice(rec.id);
          const generated = getInvoice(invoiceId!)!;
          expect(generated.status).toBe("paid");
          expect(calls.length).toBe(0);
        } finally {
          setStripeClientResolver(null);
        }
      },
    );
  });

  test("a declined charge on a profile with both flags on leaves the invoice sent and emails the customer", async () => {
    const calls: string[] = [];

    await withMockedSendInvoiceEmail(
      async (invoiceId: string) => {
        calls.push(invoiceId);
        return { success: true };
      },
      async () => {
        setStripeClientResolver(
          async () =>
            ({
              paymentIntents: {
                create: async () => {
                  const err: Error & { code?: string } = new Error("Your card was declined.");
                  err.code = "card_declined";
                  throw err;
                },
              },
            }) as any,
        );

        try {
          const custId = makeCustomer("Both Flags, Charge Fails");
          saveMethod({
            customerId: custId,
            gatewayCustomerId: "cus_both_fail",
            gatewayMethodId: "pm_both_fail",
            last4: "0002",
          });

          const template = createInvoice({
            customer_id: custId,
            issue_date: todayMinus(30),
            currency: "USD",
            items: [{ description: "Retainer", quantity: 1, unit_price: 400 }],
          });
          const rec = createRecurring({
            customer_id: custId,
            template_invoice_id: template.id,
            frequency: "monthly",
            next_run_date: todayMinus(1),
            auto_send: true,
            auto_bill: true,
          });

          const invoiceId = await generateInvoice(rec.id);
          const generated = getInvoice(invoiceId!)!;
          expect(generated.status).toBe("sent");
          expect(calls.length).toBeGreaterThan(0);
        } finally {
          setStripeClientResolver(null);
        }
      },
    );
  });
});
