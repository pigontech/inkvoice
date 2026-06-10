import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { listActivity } from "../services/activity.service";
import { createCustomer } from "../services/customer.service";
import {
  createInvoice,
  getInvoice,
  markSent,
  publishInvoice,
  recordInvoiceView,
} from "../services/invoice.service";
import { resetEnvCache } from "../utils/env";
import { isLikelyBot } from "../utils/user-agent";

const TEST_DB = "./data/test-invoice-view.db";
let app: Hono;
let token: string;

/** Create a published+sent invoice and return its share token + id. */
function shareableInvoice(): { id: string; shareToken: string } {
  const cust = createCustomer({ name: "Viewer Co", email: "viewer@example.com" });
  const inv = createInvoice({
    customer_id: cust.id,
    issue_date: "2026-03-01",
    items: [{ description: "Work", quantity: 1, unit_price: 100 }],
  });
  markSent(inv.id);
  publishInvoice(inv.id);
  const full = getInvoice(inv.id);
  if (!full?.share_token) throw new Error("no share token");
  return { id: inv.id, shareToken: full.share_token };
}

async function openPublic(shareToken: string, userAgent: string) {
  return app.request(
    new Request(`http://localhost/api/v1/public/invoices/${shareToken}`, {
      headers: { "user-agent": userAgent },
    }),
  );
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

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Version/17";

describe("isLikelyBot", () => {
  test("flags crawlers, unfurlers, and empty UAs; allows real browsers", () => {
    expect(isLikelyBot(BROWSER_UA)).toBe(false);
    expect(isLikelyBot("Googlebot/2.1")).toBe(true);
    expect(isLikelyBot("WhatsApp/2.0")).toBe(true);
    expect(isLikelyBot("curl/8.0")).toBe(true);
    expect(isLikelyBot(undefined)).toBe(true);
  });
});

describe("recordInvoiceView", () => {
  test("first call stamps first_viewed_at; later calls only bump last_viewed_at", () => {
    const { id } = shareableInvoice();
    expect(getInvoice(id)?.first_viewed_at).toBeNull();

    expect(recordInvoiceView(id).isFirstView).toBe(true);
    const afterFirst = getInvoice(id);
    expect(afterFirst?.first_viewed_at).not.toBeNull();
    expect(afterFirst?.last_viewed_at).not.toBeNull();

    expect(recordInvoiceView(id).isFirstView).toBe(false);
    // first_viewed_at is immutable once set.
    expect(getInvoice(id)?.first_viewed_at).toBe(afterFirst?.first_viewed_at);
  });
});

describe("public view stamping", () => {
  test("a browser open stamps the view and logs a 'viewed' activity", async () => {
    const { id, shareToken } = shareableInvoice();
    const res = await openPublic(shareToken, BROWSER_UA);
    expect(res.status).toBe(200);

    expect(getInvoice(id)?.first_viewed_at).not.toBeNull();

    const activity = listActivity({
      resource_type: "invoice",
      action: "viewed",
      page: 1,
      limit: 50,
    });
    expect(activity.items.some((a) => a.resource_id === id)).toBe(true);
  });

  test("a bot/unfurler open does NOT stamp a view", async () => {
    const { id, shareToken } = shareableInvoice();
    const res = await openPublic(shareToken, "Googlebot/2.1");
    expect(res.status).toBe(200);
    expect(getInvoice(id)?.first_viewed_at).toBeNull();
  });
});

describe("webhook events", () => {
  test("invoice.viewed is an advertised outgoing-webhook event", async () => {
    const res = await app.request(
      new Request("http://localhost/api/v1/outgoing-webhooks/events", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    const body = (await res.json()) as any;
    expect(body.data.events).toContain("invoice.viewed");
  });
});
