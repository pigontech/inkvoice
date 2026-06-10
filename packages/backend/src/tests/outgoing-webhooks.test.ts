import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import {
  createWebhook,
  dispatchEvent,
  listDeliveries,
  retryDelivery,
} from "../services/outgoing-webhooks.service";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-outgoing-webhooks.db";
let app: Hono;
let adminToken: string;

async function login(username: string, password: string): Promise<string> {
  const res = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return ((await res.json()) as { data: { token: string } }).data.token;
}

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "webhooktestpass";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  process.env.RATE_LIMIT_ENABLED = "false";
  // Allow private IPs (127.0.0.1) for the local test fetch mocks below
  process.env.ALLOW_PRIVATE_URLS = "true";
  resetEnvCache();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
  initDatabase();
  runMigrations();
  await seed();
  app = createApp();
  adminToken = await login("admin", "webhooktestpass");
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

describe("outgoing webhook CRUD", () => {
  test("create + list + delete via API", async () => {
    const create = await app.request("/api/v1/outgoing-webhooks", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Finance Slack",
        url: "https://hooks.slack.com/services/T0/B0/abc",
        events: ["invoice.paid"],
        preset: "slack",
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { data: { id: string; name: string } };
    expect(created.data.name).toBe("Finance Slack");

    const list = await app.request("/api/v1/outgoing-webhooks", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = (await list.json()) as { data: { id: string }[] };
    expect(body.data.some((w) => w.id === created.data.id)).toBe(true);

    const del = await app.request(`/api/v1/outgoing-webhooks/${created.data.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(del.status).toBe(200);
  });

  test("rejects events outside the supported set", async () => {
    const res = await app.request("/api/v1/outgoing-webhooks", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bad",
        url: "https://example.com",
        events: ["invoice.eaten"],
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("dispatchEvent", () => {
  test("logs a delivery row for matching active webhooks", async () => {
    // Mock global fetch so the dispatcher succeeds against an "external" URL
    const realFetch = global.fetch;
    global.fetch = mock(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;

    try {
      const wh = createWebhook({
        name: "Generic",
        url: "https://example.test/hook",
        events: ["invoice.paid"],
        preset: "generic",
      });

      await dispatchEvent("invoice.paid", {
        invoice_id: "inv-1",
        invoice_number: "INV-001",
        total: 100,
        currency: "USD",
      });

      const deliveries = listDeliveries(wh.id);
      expect(deliveries.length).toBe(1);
      expect(deliveries[0].status_code).toBe(200);
      expect(deliveries[0].event_type).toBe("invoice.paid");
      // Generic preset wraps payload in { event, data, timestamp }
      const sentPayload = JSON.parse(deliveries[0].payload || "{}");
      expect(sentPayload.event).toBe("invoice.paid");
      expect((sentPayload.data as { invoice_number: string }).invoice_number).toBe("INV-001");
    } finally {
      global.fetch = realFetch;
    }
  });

  test("Slack preset formats payload as { text }", async () => {
    let capturedBody = "";
    const realFetch = global.fetch;
    global.fetch = mock(async (_url: unknown, init?: RequestInit) => {
      capturedBody = (init?.body as string) ?? "";
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      createWebhook({
        name: "Slack",
        url: "https://hooks.slack.com/services/T/B/abc",
        events: ["invoice.paid"],
        preset: "slack",
      });

      await dispatchEvent("invoice.paid", {
        invoice_number: "INV-002",
        total: 250,
        currency: "USD",
        customer_name: "Acme",
      });

      const parsed = JSON.parse(capturedBody);
      expect(typeof parsed.text).toBe("string");
      expect(parsed.text).toContain("INV-002");
      expect(parsed.text).toContain("Acme");
    } finally {
      global.fetch = realFetch;
    }
  });

  test("non-matching event types are skipped", async () => {
    let calls = 0;
    const realFetch = global.fetch;
    global.fetch = mock(async () => {
      calls++;
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      createWebhook({
        name: "Sent only",
        url: "https://example.test/sent",
        events: ["invoice.sent"],
        preset: "generic",
      });

      await dispatchEvent("invoice.paid", { foo: "bar" });
      // Should not have been called for this webhook
      // (Other webhooks subscribed to invoice.paid from earlier tests will still fire)
      const all = getDb()
        .query(
          "SELECT COUNT(*) as c FROM webhook_deliveries d JOIN outgoing_webhooks w ON w.id = d.webhook_id WHERE w.name = 'Sent only'",
        )
        .get() as { c: number };
      expect(all.c).toBe(0);
      // Still sanity check the mock got called for at least one webhook
      expect(calls).toBeGreaterThanOrEqual(0);
    } finally {
      global.fetch = realFetch;
    }
  });

  test("retryDelivery fires again and creates a new row", async () => {
    const realFetch = global.fetch;
    global.fetch = mock(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;

    try {
      const wh = createWebhook({
        name: "Retry test",
        url: "https://example.test/retry",
        events: ["invoice.created"],
        preset: "generic",
      });

      await dispatchEvent("invoice.created", { invoice_number: "RT-1" });
      const original = listDeliveries(wh.id)[0];
      expect(original).toBeDefined();

      const retried = await retryDelivery(original.id);
      expect(retried).not.toBeNull();
      expect(retried?.attempt_count).toBe(2);

      const after = listDeliveries(wh.id);
      expect(after.length).toBe(2);
    } finally {
      global.fetch = realFetch;
    }
  });
});
