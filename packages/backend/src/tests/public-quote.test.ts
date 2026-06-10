import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-public-quote.db";
let app: Hono;
let token: string;
let customerId: string;
let quoteAId: string; // published -> accept flow + convert
let tokenA: string;
let tokenB: string; // published -> reject flow

async function authed(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    ...((opts.headers as Record<string, string>) || {}),
    Authorization: `Bearer ${token}`,
  };
  if (opts.method && opts.method !== "GET") headers["Content-Type"] = "application/json";
  return app.request(new Request(`http://localhost${path}`, { ...opts, headers }));
}

async function createPublishedQuote(): Promise<{ id: string; shareToken: string }> {
  const res = await authed("/api/v1/quotes", {
    method: "POST",
    body: JSON.stringify({
      customer_id: customerId,
      issue_date: "2026-01-15",
      items: [{ description: "Consulting", quantity: 2, unit_price: 150, tax_rate: 0 }],
    }),
  });
  const id = ((await res.json()) as any).data.id;
  const pub = await authed(`/api/v1/quotes/${id}/publish`, { method: "POST" });
  const shareToken = ((await pub.json()) as any).data.share_token;
  return { id, shareToken };
}

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "publicquotetestpass";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  process.env.RATE_LIMIT_ENABLED = "false";
  resetEnvCache();

  initDatabase();
  runMigrations();
  await seed();
  app = createApp();

  const loginRes = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "publicquotetestpass" }),
  });
  token = ((await loginRes.json()) as any).data.token;

  const cRes = await authed("/api/v1/customers", {
    method: "POST",
    body: JSON.stringify({ name: "Quote Tester" }),
  });
  customerId = ((await cRes.json()) as any).data.id;

  const a = await createPublishedQuote();
  quoteAId = a.id;
  tokenA = a.shareToken;
  const b = await createPublishedQuote();
  tokenB = b.shareToken;
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

describe("public quote accept/reject", () => {
  test("valid share token returns published quote", async () => {
    const res = await app.request(`/api/v1/public/quotes/${tokenA}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.data.quote.quote_number).toBeDefined();
    // publish does not advance status — it stays "draft"
    expect(data.data.quote.status).toBe("draft");
  });

  test("invalid (random) token returns 404 on accept", async () => {
    const res = await app.request("/api/v1/public/quotes/0000000000000000abcdef0000000000/accept", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  test("customer can accept a published quote", async () => {
    const res = await app.request(`/api/v1/public/quotes/${tokenA}/accept`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.data.status).toBe("accepted");
  });

  test("accepting again is idempotent (200, still accepted)", async () => {
    const res = await app.request(`/api/v1/public/quotes/${tokenA}/accept`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.status).toBe("accepted");
  });

  test("an accepted quote can no longer be rejected (400)", async () => {
    const res = await app.request(`/api/v1/public/quotes/${tokenA}/reject`, { method: "POST" });
    expect(res.status).toBe(400);
  });

  test("admin can convert the accepted quote to an invoice", async () => {
    const res = await authed(`/api/v1/quotes/${quoteAId}/convert`, { method: "POST" });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.data.invoice_id).toBeDefined();

    // quote should now be marked converted
    const q = await app.request(`/api/v1/public/quotes/${tokenA}`);
    // converted quotes are still published/visible; status reflects conversion
    const qd = (await q.json()) as any;
    expect(qd.data.quote.status).toBe("converted");
  });

  test("customer can reject a published quote", async () => {
    const res = await app.request(`/api/v1/public/quotes/${tokenB}/reject`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.status).toBe("rejected");
  });

  test("a rejected quote can no longer be accepted (400)", async () => {
    const res = await app.request(`/api/v1/public/quotes/${tokenB}/accept`, { method: "POST" });
    expect(res.status).toBe(400);
  });
});
