import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { unlinkSync } from "node:fs";
import bcrypt from "bcryptjs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-permissions.db";
let app: Hono;
let adminToken: string;
let userToken: string;
let userId: string;

async function login(username: string, password: string): Promise<string> {
  const res = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return ((await res.json()) as any).data.token;
}

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "permstestadminpass";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  process.env.RATE_LIMIT_ENABLED = "false";
  resetEnvCache();

  initDatabase();
  runMigrations();
  await seed();
  app = createApp();

  adminToken = await login("admin", "permstestadminpass");

  // Create a non-admin user directly in the DB
  userId = crypto.randomBytes(16).toString("hex");
  const hash = await bcrypt.hash("permstestuserpass", 10);
  getDb().run(
    "INSERT INTO users (id, username, password_hash, is_admin, is_active) VALUES (?, ?, ?, 0, 1)",
    [userId, "regular_user", hash],
  );
  userToken = await login("regular_user", "permstestuserpass");
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

function authedRequest(token: string, path: string, opts: RequestInit = {}) {
  return app.request(
    new Request(`http://localhost${path}`, {
      ...opts,
      headers: {
        ...((opts.headers as Record<string, string>) || {}),
        Authorization: `Bearer ${token}`,
      },
    }),
  );
}

describe("admin-only endpoints", () => {
  // adminOnly middleware in app.ts protects /api/v1/users, /api/v1/settings, /api/v1/export.
  const adminPaths: { path: string; method?: string }[] = [
    { path: "/api/v1/users" },
    { path: "/api/v1/settings" },
    { path: "/api/v1/export/backup" },
  ];

  for (const { path, method = "GET" } of adminPaths) {
    test(`${method} ${path} returns 403 for non-admin`, async () => {
      const res = await authedRequest(userToken, path, { method });
      expect(res.status).toBe(403);
    });

    test(`${method} ${path} succeeds for admin`, async () => {
      const res = await authedRequest(adminToken, path, { method });
      // 200 (data returned) or 204 (no content) — either way, NOT 403.
      expect(res.status).not.toBe(403);
      expect(res.status).toBeLessThan(500);
    });
  }
});

describe("auth requirement on protected endpoints", () => {
  const protectedPaths = [
    "/api/v1/invoices",
    "/api/v1/customers",
    "/api/v1/products",
    "/api/v1/dashboard/stats",
    "/api/v1/reports/aging",
  ];

  for (const path of protectedPaths) {
    test(`GET ${path} returns 401 without token`, async () => {
      const res = await app.request(path);
      expect(res.status).toBe(401);
    });
  }
});

describe("requirePermission middleware (unit)", () => {
  // The requirePermission helper in middleware/auth.ts isn't currently wired
  // to routes, but the schema and the helper exist. Verify the helper
  // returns 403 when the (resource, action) row is missing and proceeds when it
  // exists.
  test("missing (resource, action) row → 403", async () => {
    const { requirePermission } = await import("../middleware/auth");
    const handler = requirePermission("invoices", "delete");
    let nextCalled = false;
    const c = {
      get: (k: string) => (k === "user" ? { sub: userId, is_admin: false } : undefined),
      json: (body: unknown, status: number) => new Response(JSON.stringify(body), { status }),
    } as any;
    const result = await handler(c, async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect((result as Response).status).toBe(403);
  });

  test("granted (resource, action) row → next()", async () => {
    const db = getDb();
    db.run("INSERT INTO user_permissions (id, user_id, resource, action) VALUES (?, ?, ?, ?)", [
      crypto.randomBytes(16).toString("hex"),
      userId,
      "invoices",
      "delete",
    ]);
    const { requirePermission } = await import("../middleware/auth");
    const handler = requirePermission("invoices", "delete");
    let nextCalled = false;
    const c = {
      get: (k: string) => (k === "user" ? { sub: userId, is_admin: false } : undefined),
      json: () => new Response(),
    } as any;
    await handler(c, async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  test("admin user bypasses permission check", async () => {
    const { requirePermission } = await import("../middleware/auth");
    const handler = requirePermission("settings", "update");
    let nextCalled = false;
    const c = {
      get: (k: string) => (k === "user" ? { sub: "admin-id", is_admin: true } : undefined),
      json: () => new Response(),
    } as any;
    await handler(c, async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });
});
