import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { createCustomer } from "../services/customer.service";
import { getStats } from "../services/dashboard.service";
import { getBaseCurrency } from "../services/exchange-rate.service";
import {
  createCreditNote,
  createInvoice,
  markSent,
  voidInvoice,
} from "../services/invoice.service";
import { recordPayment } from "../services/payment.service";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-dashboard-outstanding.db";

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "testpass123";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  resetEnvCache();
  initDatabase();
  runMigrations();
  await seed();
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
});

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function draftInvoice(
  customerId: string,
  amount: number,
  extra: { currency?: string; exchange_rate?: number } = {},
): string {
  return createInvoice({
    customer_id: customerId,
    issue_date: today(),
    items: [{ description: "Work", quantity: 1, unit_price: amount }],
    ...extra,
  }).id;
}

function sentInvoice(
  customerId: string,
  amount: number,
  extra: { currency?: string; exchange_rate?: number } = {},
): string {
  const id = draftInvoice(customerId, amount, extra);
  markSent(id);
  return id;
}

function pay(invoiceId: string, amount: number): void {
  const res = recordPayment(invoiceId, { amount, payment_date: today() });
  if (!res.success) throw new Error(res.error);
}

function statusOf(invoiceId: string): string {
  const row = getDb().query("SELECT status FROM invoices WHERE id = ?").get(invoiceId) as {
    status: string;
  };
  return row.status;
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

describe("dashboard outstanding", () => {
  test("counts what is still due on sent, partially paid and overdue invoices", () => {
    const before = getStats();
    const customer = createCustomer({ name: "Outstanding Co" });

    // Sent, nothing paid: 300 due.
    sentInvoice(customer.id, 300);

    // Partially paid: 1000 total, 400 received, 600 due.
    const partial = sentInvoice(customer.id, 1000);
    pay(partial, 400);
    expect(statusOf(partial)).toBe("partially_paid");

    // Partially paid, then past due: 500 total, 200 received, 300 due.
    const overdue = sentInvoice(customer.id, 500);
    pay(overdue, 200);
    getDb().run("UPDATE invoices SET status = 'overdue' WHERE id = ?", [overdue]);

    // Partially paid in another currency: 200 total, 50 received, 150 due at
    // rate 1.5, so 225 in the base currency.
    const foreignCurrency = getBaseCurrency().toUpperCase() === "EUR" ? "GBP" : "EUR";
    const foreign = sentInvoice(customer.id, 200, {
      currency: foreignCurrency,
      exchange_rate: 1.5,
    });
    pay(foreign, 50);
    expect(statusOf(foreign)).toBe("partially_paid");

    // Sent and fully credited: +100 and an issued credit note of -100.
    const credited = sentInvoice(customer.id, 100);
    const creditNote = createCreditNote(credited);
    if (!creditNote.success) throw new Error(creditNote.error);
    markSent(creditNote.data.id);
    expect(statusOf(creditNote.data.id)).toBe("sent");

    // Not due: paid in full, still a draft, voided.
    const paid = sentInvoice(customer.id, 250);
    pay(paid, 250);
    draftInvoice(customer.id, 700);
    const voided = sentInvoice(customer.id, 400);
    voidInvoice(voided);
    expect(statusOf(voided)).toBe("voided");

    // 300 + 600 + 300 + 225 + 100 - 100 = 1425
    const after = getStats();
    expect(after.total_outstanding - before.total_outstanding).toBeCloseTo(1425, 2);
    expect(sum(after.trends.total_outstanding) - sum(before.trends.total_outstanding)).toBeCloseTo(
      1425,
      2,
    );
  });
});
