import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { resetRateLimitsForTesting } from "../middleware/rate-limiter";
import { setResetUrlBuilder } from "../routes/auth";
import { setSystemMailSender } from "../services/system-mail";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-password-reset.db";
let app: Hono;

const sentMail: Array<{ to: string; template: string; vars: Record<string, string> }> = [];

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "testpass1234";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  process.env.RATE_LIMIT_ENABLED = "true";
  process.env.PUBLIC_BASE_URL = "https://invoices.example.com/";
  resetEnvCache();
  resetRateLimitsForTesting();

  initDatabase();
  runMigrations();
  await seed();

  // The seeded admin needs an email for forgot-password to find them.
  getDb().run("UPDATE users SET email = 'admin@test.example' WHERE username = 'admin'");

  app = createApp();
});

afterAll(() => {
  setSystemMailSender(null);
  setResetUrlBuilder(null);
  delete process.env.PUBLIC_BASE_URL;
  closeDatabase();
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${ext}`);
    } catch {}
  }
});

beforeEach(() => {
  sentMail.length = 0;
  // Capture platform mail through the extension point — no SMTP needed.
  setSystemMailSender(async (input) => {
    sentMail.push({ to: input.to, template: input.template, vars: input.vars });
    return { success: true };
  });
});

async function forgot(email: string, ip = "10.1.0.1") {
  return app.request("/api/v1/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email }),
  });
}

async function reset(token: string, password: string) {
  return app.request("/api/v1/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "10.1.0.1" },
    body: JSON.stringify({ token, password }),
  });
}

describe("password reset", () => {
  test("forgot-password returns 202 for unknown email and sends nothing", async () => {
    const res = await forgot("nobody@example.com");
    expect(res.status).toBe(202);
    expect(sentMail).toHaveLength(0);
  });

  test("reset link uses PUBLIC_BASE_URL (trailing slash trimmed) by default", async () => {
    const res = await forgot("admin@test.example", "10.1.0.2");
    expect(res.status).toBe(202);
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].to).toBe("admin@test.example");
    expect(sentMail[0].template).toBe("password-reset");
    expect(sentMail[0].vars.resetUrl).toMatch(
      /^https:\/\/invoices\.example\.com\/reset-password\?token=[a-f0-9]{64}$/,
    );
  });

  test("a registered reset-URL builder overrides the default link", async () => {
    setResetUrlBuilder(
      (_c, token) => `https://acme.upstream.example/reset-password?token=${token}`,
    );
    try {
      await forgot("admin@test.example", "10.1.0.3");
      expect(sentMail).toHaveLength(1);
      expect(sentMail[0].vars.resetUrl).toMatch(
        /^https:\/\/acme\.upstream\.example\/reset-password/,
      );
    } finally {
      setResetUrlBuilder(null);
    }
  });

  test("without a platform sender the route still returns 202 (SMTP unconfigured no-op)", async () => {
    setSystemMailSender(null);
    const res = await forgot("admin@test.example", "10.1.0.4");
    expect(res.status).toBe(202);
    expect(sentMail).toHaveLength(0);
  });

  test("reset-password with a valid token sets the new password", async () => {
    await forgot("admin@test.example", "10.1.0.5");
    const token = (sentMail[0].vars.resetUrl.match(/token=([a-f0-9]+)/) ?? [])[1];
    expect(token).toBeTruthy();

    const res = await reset(token, "newpassword1234");
    expect(res.status).toBe(200);

    const fail = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "testpass1234" }),
    });
    expect(fail.status).toBe(401);

    const ok = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "newpassword1234" }),
    });
    expect(ok.status).toBe(200);
  });

  test("reset-password rejects a reused token", async () => {
    await forgot("admin@test.example", "10.1.0.6");
    const token = (sentMail[0].vars.resetUrl.match(/token=([a-f0-9]+)/) ?? [])[1];

    const first = await reset(token, "anotherpassword1");
    expect(first.status).toBe(200);
    const second = await reset(token, "anotherpassword2");
    expect(second.status).toBe(410);
  });
});
