import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { resetEnvCache } from "../utils/env";
import { signToken, verifyToken } from "../utils/jwt";

const TEST_DB = "./data/test-auth.db";
let app: Hono;

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
});

afterAll(() => {
  closeDatabase();
  try {
    unlinkSync(TEST_DB);
  } catch {}
  try {
    unlinkSync(`${TEST_DB}-wal`);
  } catch {}
  try {
    unlinkSync(`${TEST_DB}-shm`);
  } catch {}
});

describe("JWT", () => {
  test("sign and verify token", async () => {
    const token = await signToken({ sub: "test-id", username: "admin", is_admin: true });
    expect(token).toBeDefined();
    const payload = await verifyToken(token);
    expect(payload.sub).toBe("test-id");
    expect(payload.username).toBe("admin");
  });
});

describe("Auth", () => {
  test("POST /api/v1/auth/login with valid credentials", async () => {
    const res = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "testpass123" }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.data.token).toBeDefined();
    expect(data.data.user.username).toBe("admin");
    expect(data.data.user.is_admin).toBe(true);
  });

  test("POST /api/v1/auth/login with invalid credentials", async () => {
    const res = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "wrong" }),
    });
    expect(res.status).toBe(401);
  });

  test("POST /api/v1/auth/login with missing fields returns 400", async () => {
    const res = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/v1/auth/me without token returns 401", async () => {
    const res = await app.request("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });

  test("GET /api/v1/auth/me with valid token", async () => {
    // Login first
    const loginRes = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "testpass123" }),
    });
    const loginData = (await loginRes.json()) as any;
    const token = loginData.data.token;

    // Try /me
    const req = new Request("http://localhost/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await app.request(req);
    const data = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.username).toBe("admin");
  });

  test("GET /api/v1/auth/me with invalid token returns 401", async () => {
    const req = new Request("http://localhost/api/v1/auth/me", {
      headers: { Authorization: "Bearer invalidtoken" },
    });
    const res = await app.request(req);
    expect(res.status).toBe(401);
  });

  test("GET /health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.status).toBe("ok");
  });

  test("Security headers present", async () => {
    const res = await app.request("/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });
});
