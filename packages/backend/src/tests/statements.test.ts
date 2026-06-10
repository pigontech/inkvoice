import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { createCustomer } from "../services/customer.service";
import { createInvoice, markSent } from "../services/invoice.service";
import { recordPayment } from "../services/payment.service";
import { buildStatementData } from "../services/statement.service";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-statements.db";
let app: Hono;
let token: string;

async function authed(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    ...((opts.headers as Record<string, string>) || {}),
    Authorization: `Bearer ${token}`,
  };
  return app.request(new Request(`http://localhost${path}`, { ...opts, headers }));
}

function makeInvoice(
  customerId: string,
  issueDate: string,
  unitPrice: number,
  opts: { type?: "invoice" | "credit_note"; currency?: string; exchange_rate?: number } = {},
) {
  const inv = createInvoice({
    customer_id: customerId,
    issue_date: issueDate,
    type: opts.type ?? "invoice",
    currency: opts.currency ?? "USD",
    exchange_rate: opts.exchange_rate,
    items: [{ description: "Item", quantity: 1, unit_price: unitPrice }],
  });
  markSent(inv.id);
  return inv;
}

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "testpass123";
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
    body: JSON.stringify({ username: "admin", password: "testpass123" }),
  });
  token = ((await res.json()) as any).data.token;
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
});

describe("statement balance math", () => {
  test("opening balance, running balance, credits, and closing balance", () => {
    const cust = createCustomer({ name: "Acme Co", email: "acme@example.com" });
    makeInvoice(cust.id, "2026-01-10", 100); // before period → opening
    makeInvoice(cust.id, "2026-03-05", 200); // in period (charge)
    makeInvoice(cust.id, "2026-03-10", -30, { type: "credit_note" }); // in period (credit)

    const data = buildStatementData(cust.id, "2026-02-01", "2026-03-31");
    expect(data).not.toBeNull();
    if (!data) return;

    // Opening = the 2026-01-10 invoice of 100 (dated before the period).
    expect(data.opening_balance_raw).toBe(100);
    // Period: +200 invoice, -30 credit note. Closing = 100 + 200 - 30 = 270.
    expect(data.closing_balance_raw).toBe(270);
    expect(data.has_lines).toBe(true);
    expect(data.lines.length).toBe(2);
  });

  test("payments reduce the balance and appear as period lines", () => {
    const cust = createCustomer({ name: "Pay Co", email: "pay@example.com" });
    const inv = makeInvoice(cust.id, "2026-01-10", 100); // opening 100
    recordPayment(inv.id, { amount: 40, payment_date: "2026-02-15", method: "cash" });

    const data = buildStatementData(cust.id, "2026-02-01", "2026-03-31");
    if (!data) throw new Error("no data");
    expect(data.opening_balance_raw).toBe(100);
    // One payment line of -40 → closing 60.
    expect(data.lines.length).toBe(1);
    expect(data.closing_balance_raw).toBe(60);
  });

  test("aging buckets the customer's outstanding invoices in base currency", () => {
    const cust = createCustomer({ name: "Age Co", email: "age@example.com" });
    makeInvoice(cust.id, "2026-01-10", 100);
    makeInvoice(cust.id, "2026-01-10", 200);

    const data = buildStatementData(cust.id, "2026-01-01", "2026-12-31");
    if (!data) throw new Error("no data");
    expect(data.aging_total_raw).toBe(300);
  });

  test("multi-currency amounts are consolidated via exchange_rate", () => {
    const cust = createCustomer({ name: "Euro Co", email: "euro@example.com" });
    // 100 EUR at rate 2 → 200 in base currency.
    makeInvoice(cust.id, "2026-01-05", 100, { currency: "EUR", exchange_rate: 2 });

    const data = buildStatementData(cust.id, "2026-01-01", "2026-12-31");
    if (!data) throw new Error("no data");
    expect(data.closing_balance_raw).toBe(200);
  });

  test("returns null for an unknown customer", () => {
    expect(buildStatementData("does-not-exist", "2026-01-01", "2026-12-31")).toBeNull();
  });
});

describe("statement HTTP route", () => {
  test("GET returns print-ready HTML for the customer", async () => {
    const cust = createCustomer({ name: "Html Co", email: "html@example.com" });
    makeInvoice(cust.id, "2026-03-01", 150);

    const res = await authed(
      `/api/v1/customers/${cust.id}/statement?from=2026-01-01&to=2026-12-31`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Html Co");
    expect(html).toContain("<table");
  });

  test("GET returns 404 for an unknown customer", async () => {
    const res = await authed("/api/v1/customers/nope/statement");
    expect(res.status).toBe(404);
  });
});
