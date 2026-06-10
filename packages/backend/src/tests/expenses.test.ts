import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-expenses.db";
let app: Hono;
let token: string;

async function authed(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    ...((opts.headers as Record<string, string>) || {}),
    Authorization: `Bearer ${token}`,
  };
  if (!(opts.body instanceof FormData) && opts.method && opts.method !== "GET") {
    headers["Content-Type"] = "application/json";
  }
  return app.request(new Request(`http://localhost${path}`, { ...opts, headers }));
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
  const data = (await res.json()) as any;
  token = data.data.token;
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
});

describe("Expenses", () => {
  let expenseId: string;
  let taxId: string;
  let customerId: string;

  test("setup: tax definition + customer exist", async () => {
    const taxRes = await authed("/api/v1/tax-definitions");
    const taxData = (await taxRes.json()) as any;
    expect(taxData.success).toBe(true);
    expect(taxData.data.length).toBeGreaterThan(0);
    taxId = taxData.data[0].id;

    const custRes = await authed("/api/v1/customers", {
      method: "POST",
      body: JSON.stringify({ name: "Expense Client", email: "ec@example.com" }),
    });
    customerId = ((await custRes.json()) as any).data.id;
  });

  test("create expense computes tax and total", async () => {
    const taxRes = await authed(`/api/v1/tax-definitions`);
    const rate = ((await taxRes.json()) as any).data.find((t: any) => t.id === taxId).rate;

    const res = await authed("/api/v1/expenses", {
      method: "POST",
      body: JSON.stringify({
        vendor: "Acme Supplies",
        category: "Office",
        expense_date: "2026-05-01",
        amount: 100,
        tax_id: taxId,
        currency: "USD",
      }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expenseId = data.data.id;
    expect(data.data.tax_rate).toBe(rate);
    expect(data.data.tax_amount).toBeCloseTo((100 * rate) / 100, 2);
    expect(data.data.total).toBeCloseTo(100 + (100 * rate) / 100, 2);
  });

  test("list and filter by billable", async () => {
    const all = await authed("/api/v1/expenses");
    const allData = (await all.json()) as any;
    expect(allData.data.total).toBe(1);

    const billable = await authed("/api/v1/expenses?billable=true");
    expect(((await billable.json()) as any).data.total).toBe(0);
  });

  test("update expense to billable + linked customer", async () => {
    const res = await authed(`/api/v1/expenses/${expenseId}`, {
      method: "PUT",
      body: JSON.stringify({
        vendor: "Acme Supplies",
        category: "Office",
        expense_date: "2026-05-01",
        amount: 100,
        tax_id: taxId,
        currency: "USD",
        customer_id: customerId,
        is_billable: 1,
      }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.is_billable).toBe(1);
    expect(data.data.customer_id).toBe(customerId);
  });

  test("rebill creates an invoice and stamps the expense", async () => {
    const res = await authed(`/api/v1/expenses/${expenseId}/rebill`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    const invoiceId = data.data.invoice_id;
    expect(invoiceId).toBeTruthy();

    const inv = await authed(`/api/v1/invoices/${invoiceId}`);
    const invData = (await inv.json()) as any;
    expect(invData.data.customer_id).toBe(customerId);
    expect(invData.data.items.length).toBe(1);
    expect(invData.data.items[0].unit_price).toBe(100);

    // Second rebill must fail (already billed).
    const again = await authed(`/api/v1/expenses/${expenseId}/rebill`, { method: "POST" });
    expect(again.status).toBe(409);
  });

  test("expenses-by-category report", async () => {
    const res = await authed("/api/v1/reports/expenses-by-category");
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    const office = data.data.rows.find((r: any) => r.category === "Office");
    expect(office).toBeTruthy();
    expect(office.count).toBe(1);
    expect(data.data.total).toBeGreaterThan(0);
  });

  test("profit-loss report subtracts expenses from revenue", async () => {
    const res = await authed("/api/v1/reports/profit-loss");
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.data.expenses).toBeGreaterThan(0);
    expect(data.data.net).toBe(data.data.revenue - data.data.expenses);
  });

  test("dashboard stats expose total_expenses and net_income", async () => {
    const res = await authed("/api/v1/dashboard/stats");
    const data = (await res.json()) as any;
    expect(data.data.total_expenses).toBeGreaterThan(0);
    expect(data.data.net_income).toBe(data.data.total_revenue - data.data.total_expenses);
  });

  test("CSV export includes the expense", async () => {
    const res = await authed("/api/v1/expenses/export/csv");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Acme Supplies");
  });

  test("delete expense", async () => {
    const res = await authed(`/api/v1/expenses/${expenseId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const after = await authed("/api/v1/expenses");
    expect(((await after.json()) as any).data.total).toBe(0);
  });
});
