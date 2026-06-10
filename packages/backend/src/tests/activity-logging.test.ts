import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-activity-logging.db";
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

function authedJson(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function activityRows(resourceType: string): Array<{ action: string; metadata: string | null }> {
  return getDb()
    .query("SELECT action, metadata FROM activity_log WHERE resource_type = ? ORDER BY rowid")
    .all(resourceType) as Array<{ action: string; metadata: string | null }>;
}

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "activitylogtestpass";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  process.env.RATE_LIMIT_ENABLED = "false";
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
  adminToken = await login("admin", "activitylogtestpass");
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

describe("activity logging for customers, products, quotes", () => {
  test("customer create/update/delete are logged with the customer name", async () => {
    const created = await authedJson("POST", "/api/v1/customers", { name: "Log Test Co" });
    expect(created.status).toBe(201);
    const customerId = ((await created.json()) as { data: { id: string } }).data.id;

    const updated = await authedJson("PUT", `/api/v1/customers/${customerId}`, {
      name: "Log Test Co (renamed)",
    });
    expect(updated.status).toBe(200);

    const deleted = await authedJson("DELETE", `/api/v1/customers/${customerId}`);
    expect(deleted.status).toBe(200);

    const rows = activityRows("customer");
    expect(rows.map((r) => r.action)).toEqual(["created", "updated", "deleted"]);
    expect(rows[0].metadata).toContain("Log Test Co");
    // The delete entry preserves the (renamed) customer name for the log.
    expect(rows[2].metadata).toContain("renamed");
  });

  test("product create/update/delete are logged with the product name", async () => {
    const created = await authedJson("POST", "/api/v1/products", {
      name: "Log Widget",
      unit_price: 10,
    });
    expect(created.status).toBe(201);
    const productId = ((await created.json()) as { data: { id: string } }).data.id;

    await authedJson("PUT", `/api/v1/products/${productId}`, {
      name: "Log Widget v2",
      unit_price: 12,
    });
    await authedJson("DELETE", `/api/v1/products/${productId}`);

    const rows = activityRows("product");
    expect(rows.map((r) => r.action)).toEqual(["created", "updated", "deleted"]);
    expect(rows[0].metadata).toContain("Log Widget");
  });

  test("quote create/publish/accept/convert/delete are logged with the quote number", async () => {
    const customer = await authedJson("POST", "/api/v1/customers", { name: "Quote Log Co" });
    const customerId = ((await customer.json()) as { data: { id: string } }).data.id;

    const created = await authedJson("POST", "/api/v1/quotes", {
      customer_id: customerId,
      issue_date: "2026-06-07",
      items: [{ description: "Consulting", quantity: 1, unit_price: 100 }],
    });
    expect(created.status).toBe(201);
    const quote = ((await created.json()) as { data: { id: string; quote_number: string } }).data;

    expect((await authedJson("POST", `/api/v1/quotes/${quote.id}/publish`)).status).toBe(200);
    expect((await authedJson("POST", `/api/v1/quotes/${quote.id}/accept`)).status).toBe(200);
    expect((await authedJson("POST", `/api/v1/quotes/${quote.id}/convert`)).status).toBe(201);

    const actions = activityRows("quote").map((r) => r.action);
    expect(actions).toEqual(["created", "published", "accepted", "converted"]);
    const rows = activityRows("quote");
    expect(rows[0].metadata).toContain(quote.quote_number);
  });
});
