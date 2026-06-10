import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-portal.db";
let app: Hono;
let token: string;
let customerId: string;
let portalToken: string;
let invoiceId: string;
let invoice2Id: string;

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
  process.env.ADMIN_PASS = "portaltestpass";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  process.env.RATE_LIMIT_ENABLED = "false";
  resetEnvCache();

  initDatabase();
  runMigrations();
  await seed();
  app = createApp();

  // Login
  const loginRes = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "portaltestpass" }),
  });
  token = ((await loginRes.json()) as any).data.token;

  // Customer with email
  const cRes = await authed("/api/v1/customers", {
    method: "POST",
    body: JSON.stringify({ name: "Portal Tester", email: "tester@example.com" }),
  });
  customerId = ((await cRes.json()) as any).data.id;

  // Two published invoices in different years
  for (const date of ["2025-06-15", "2026-02-10"]) {
    const inv = await authed("/api/v1/invoices", {
      method: "POST",
      body: JSON.stringify({
        customer_id: customerId,
        issue_date: date,
        items: [{ description: "Service", quantity: 1, unit_price: 100, tax_rate: 0 }],
      }),
    });
    const id = ((await inv.json()) as any).data.id;
    await authed(`/api/v1/invoices/${id}/mark-sent`, { method: "POST" });
    if (!invoiceId) invoiceId = id;
    else invoice2Id = id;
  }
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

describe("portal access toggle", () => {
  test("enable returns a token and sets portal_enabled", async () => {
    const res = await authed(`/api/v1/customers/${customerId}/portal`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(typeof data.data.token).toBe("string");
    expect(data.data.token.length).toBeGreaterThan(20);
    portalToken = data.data.token;
    // SMTP isn't configured in tests, so welcome email is "skipped".
    expect(["sent", "skipped", "failed"]).toContain(data.data.email_status);

    const c = (await (await authed(`/api/v1/customers/${customerId}`)).json()) as any;
    expect(c.data.portal_enabled).toBe(1);
    expect(c.data.portal_token).toBe(portalToken);
  });

  test("enable is idempotent (same token on second call)", async () => {
    const res = await authed(`/api/v1/customers/${customerId}/portal`, { method: "POST" });
    const data = (await res.json()) as any;
    expect(data.data.token).toBe(portalToken);
  });

  test("disable clears portal_token and flips flag", async () => {
    const res = await authed(`/api/v1/customers/${customerId}/portal`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const c = (await (await authed(`/api/v1/customers/${customerId}`)).json()) as any;
    expect(c.data.portal_enabled).toBe(0);
    expect(c.data.portal_token).toBeNull();

    // Old token now 404s
    const oldFetch = await app.request(`/api/v1/public/portal/${portalToken}`);
    expect(oldFetch.status).toBe(404);

    // Re-enable issues a fresh token
    const re = await authed(`/api/v1/customers/${customerId}/portal`, { method: "POST" });
    const reData = (await re.json()) as any;
    expect(reData.data.token).not.toBe(portalToken);
    portalToken = reData.data.token;
  });
});

describe("portal year-zip download", () => {
  test("returns a non-empty zip for a year with invoices", async () => {
    const res = await app.request(`/api/v1/public/portal/${portalToken}/invoices.zip?year=2026`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/invoices-Portal_Tester-2026\.zip/);
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(50);
    // ZIP magic: 0x50 0x4B 0x03 0x04 (PK..)
    const view = new Uint8Array(buf);
    expect(view[0]).toBe(0x50);
    expect(view[1]).toBe(0x4b);
  });

  test("returns 404 for a year with no invoices", async () => {
    const res = await app.request(`/api/v1/public/portal/${portalToken}/invoices.zip?year=2010`);
    expect(res.status).toBe(404);
  });

  test("rejects invalid year", async () => {
    const res = await app.request(`/api/v1/public/portal/${portalToken}/invoices.zip?year=abc`);
    expect(res.status).toBe(400);
  });

  test("rejects unknown portal token", async () => {
    const res = await app.request(`/api/v1/public/portal/000000aabbcc/invoices.zip?year=2026`);
    expect(res.status).toBe(404);
  });
});

describe("invoice comment thread", () => {
  test("starts empty", async () => {
    const res = await app.request(
      `/api/v1/public/portal/${portalToken}/invoices/${invoiceId}/comments`,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data).toEqual([]);
  });

  test("customer can post a comment via the portal", async () => {
    const res = await app.request(
      `/api/v1/public/portal/${portalToken}/invoices/${invoiceId}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "Hi, when is the new line item billed?" }),
      },
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.data.author_type).toBe("customer");
    expect(data.data.author_name).toBe("Portal Tester");
    expect(data.data.body).toContain("when is the new line item");
  });

  test("staff can reply via the authenticated route", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: "Next month — see updated due date." }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.data.author_type).toBe("staff");
  });

  test("portal listing shows both messages in order", async () => {
    const res = await app.request(
      `/api/v1/public/portal/${portalToken}/invoices/${invoiceId}/comments`,
    );
    const data = (await res.json()) as any;
    expect(data.data.length).toBe(2);
    expect(data.data[0].author_type).toBe("customer");
    expect(data.data[1].author_type).toBe("staff");
  });

  test("rejects empty comment body", async () => {
    const res = await app.request(
      `/api/v1/public/portal/${portalToken}/invoices/${invoiceId}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "   " }),
      },
    );
    expect(res.status).toBe(400);
  });

  test("rejects comment on someone else's invoice", async () => {
    // Create a second customer + their invoice; the first customer's portal
    // token must not be able to comment on it.
    const cRes = await authed("/api/v1/customers", {
      method: "POST",
      body: JSON.stringify({ name: "Other Co" }),
    });
    const otherCustomerId = ((await cRes.json()) as any).data.id;
    const inv = await authed("/api/v1/invoices", {
      method: "POST",
      body: JSON.stringify({
        customer_id: otherCustomerId,
        issue_date: "2026-03-01",
        items: [{ description: "X", quantity: 1, unit_price: 10, tax_rate: 0 }],
      }),
    });
    const otherInvoiceId = ((await inv.json()) as any).data.id;

    const res = await app.request(
      `/api/v1/public/portal/${portalToken}/invoices/${otherInvoiceId}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "Sneaky" }),
      },
    );
    expect(res.status).toBe(404);

    // Cleanup so the unused-var lint doesn't trip
    void invoice2Id;
  });
});
