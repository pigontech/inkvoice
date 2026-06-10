import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { unlinkSync } from "node:fs";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { createInvoice } from "../services/invoice.service";
import { createRecurring, generateInvoice, processAllDue } from "../services/recurring.service";
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

describe("recurring invoice scheduler", () => {
  test("generateInvoice materializes a new invoice and advances next_run_date", () => {
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

    const newInvoiceId = generateInvoice(schedule.id);
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

  test("processAllDue fires for active schedules whose next_run_date is past", () => {
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

    const result = processAllDue();
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

  test("schedule transitions to completed when next_run_date passes end_date", () => {
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

    generateInvoice(schedule.id);
    const after = getDb()
      .query("SELECT status FROM recurring_invoices WHERE id = ?")
      .get(schedule.id) as { status: string };
    expect(after.status).toBe("completed");
  });

  test("paused schedule does not generate", () => {
    const templateId = makeTemplateInvoice();
    const schedule = createRecurring({
      customer_id: customerId,
      template_invoice_id: templateId,
      frequency: "monthly",
      interval_value: 1,
      next_run_date: todayMinus(1),
    });
    getDb().run("UPDATE recurring_invoices SET status = 'paused' WHERE id = ?", [schedule.id]);
    const result = generateInvoice(schedule.id);
    expect(result).toBeNull();
  });
});
