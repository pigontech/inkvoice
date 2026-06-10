import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-api-cache-control.db";
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
  process.env.ADMIN_PASS = "cachecontroltestpass";
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
  adminToken = await login("admin", "cachecontroltestpass");
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

describe("API Cache-Control", () => {
  test("successful API responses carry Cache-Control: no-store", async () => {
    const res = await app.request("/api/v1/activity?page=1&limit=30", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  test("error API responses carry Cache-Control: no-store", async () => {
    // Unauthenticated request → 401 from auth middleware. If error responses
    // were cacheable, a stale 401/404 could shadow the endpoint forever
    // (the original notification-bell bug).
    const res = await app.request("/api/v1/activity?limit=30");
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("API 404 JSON contract", () => {
  test("unknown /api/* path returns JSON 404, not HTML/text", async () => {
    const res = await app.request("/api/v1/does-not-exist", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
  });

  test("trailing-slash variant of a real route returns JSON 404", async () => {
    const res = await app.request("/api/v1/activity/", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
  });
});
