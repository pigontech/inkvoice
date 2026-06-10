import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { crossRate, parseEcbXml } from "../services/exchange-rate.service";
import { resetEnvCache } from "../utils/env";

describe("exchange-rate math (pure, no network)", () => {
  test("crossRate converts via the EUR base table", () => {
    const eur = { USD: 1.1, GBP: 0.8 };
    expect(crossRate(eur, "EUR", "USD")).toBeCloseTo(1.1, 6);
    expect(crossRate(eur, "USD", "EUR")).toBeCloseTo(1 / 1.1, 6);
    expect(crossRate(eur, "USD", "GBP")).toBeCloseTo(0.8 / 1.1, 6);
    expect(crossRate(eur, "USD", "USD")).toBe(1);
    expect(crossRate(eur, "USD", "JPY")).toBeNull();
  });

  test("parseEcbXml extracts the rate table", () => {
    const xml = `<Cube>
      <Cube time='2026-06-06'>
        <Cube currency='USD' rate='1.0823'/>
        <Cube currency='GBP' rate='0.8456'/>
      </Cube></Cube>`;
    const rates = parseEcbXml(xml);
    expect(rates.USD).toBeCloseTo(1.0823, 4);
    expect(rates.GBP).toBeCloseTo(0.8456, 4);
    expect(Object.keys(rates)).toHaveLength(2);
  });
});

const TEST_DB = "./data/test-multi-currency.db";
let app: Hono;
let token: string;

async function authed(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    ...((opts.headers as Record<string, string>) || {}),
    Authorization: `Bearer ${token}`,
  };
  if (opts.method && opts.method !== "GET") headers["Content-Type"] = "application/json";
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

describe("Multi-currency consolidation (base = USD)", () => {
  let customerId: string;

  async function createPaidInvoice(currency: string, unitPrice: number, exchangeRate?: number) {
    const res = await authed("/api/v1/invoices", {
      method: "POST",
      body: JSON.stringify({
        customer_id: customerId,
        issue_date: "2026-05-01",
        currency,
        ...(exchangeRate ? { exchange_rate: exchangeRate } : {}),
        items: [{ description: "Service", quantity: 1, unit_price: unitPrice }],
      }),
    });
    const inv = ((await res.json()) as any).data;
    await authed(`/api/v1/invoices/${inv.id}/mark-sent`, { method: "POST" });
    await authed(`/api/v1/invoices/${inv.id}/mark-paid`, { method: "POST" });
    return inv;
  }

  test("setup customer", async () => {
    const res = await authed("/api/v1/customers", {
      method: "POST",
      body: JSON.stringify({ name: "Global Corp", email: "g@example.com", currency: "EUR" }),
    });
    const data = (await res.json()) as any;
    customerId = data.data.id;
    expect(data.data.currency).toBe("EUR");
  });

  test("base-currency invoice freezes rate to 1; foreign keeps supplied rate", async () => {
    const usd = await createPaidInvoice("USD", 100); // base currency → rate forced to 1
    const eur = await createPaidInvoice("EUR", 200, 1.1); // base = 200 * 1.1 = 220

    expect(usd.exchange_rate).toBe(1);
    expect(eur.exchange_rate).toBeCloseTo(1.1, 6);
  });

  test("dashboard revenue is consolidated into base currency", async () => {
    const res = await authed("/api/v1/dashboard/stats");
    const data = ((await res.json()) as any).data;
    expect(data.base_currency).toBe("USD");
    // 100 (USD @1) + 220 (EUR @1.1) = 320
    expect(data.total_revenue).toBeCloseTo(320, 2);
    expect(data.net_income).toBeCloseTo(320, 2);
  });

  test("profit-loss consolidates revenue", async () => {
    const res = await authed("/api/v1/reports/profit-loss");
    const data = ((await res.json()) as any).data;
    expect(data.base_currency).toBe("USD");
    expect(data.revenue).toBeCloseTo(320, 2);
  });

  test("currency breakdown shows native + base totals per currency", async () => {
    const res = await authed("/api/v1/reports/currency-breakdown");
    const data = ((await res.json()) as any).data;
    const usd = data.rows.find((r: any) => r.currency === "USD");
    const eur = data.rows.find((r: any) => r.currency === "EUR");
    expect(usd.native_total).toBeCloseTo(100, 2);
    expect(usd.base_total).toBeCloseTo(100, 2);
    expect(eur.native_total).toBeCloseTo(200, 2);
    expect(eur.base_total).toBeCloseTo(220, 2);
    expect(eur.exchange_rate).toBeCloseTo(1.1, 6);
    expect(data.base_total).toBeCloseTo(320, 2);
  });

  test("revenue-by-customer is consolidated", async () => {
    const res = await authed("/api/v1/reports/revenue-by-customer");
    const data = ((await res.json()) as any).data;
    const row = data.find((r: any) => r.customer_name === "Global Corp");
    expect(row.total_revenue).toBeCloseTo(320, 2);
  });

  test("exchange-rate endpoint short-circuits same currency without network", async () => {
    const res = await authed("/api/v1/exchange-rate?from=USD&to=USD");
    const data = ((await res.json()) as any).data;
    expect(data.rate).toBe(1);
  });

  test("exchange-rate endpoint rejects malformed currency codes", async () => {
    const res = await authed("/api/v1/exchange-rate?from=US&to=USD");
    expect(res.status).toBe(400);
  });
});
