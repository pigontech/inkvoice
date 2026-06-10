import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-metrics.db";
let app: Hono;

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "metricstestpass";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  process.env.RATE_LIMIT_ENABLED = "false";
  delete process.env.METRICS_TOKEN;
  resetEnvCache();

  initDatabase();
  runMigrations();
  await seed();
  app = createApp();
});

afterAll(() => {
  closeDatabase();
  delete process.env.METRICS_TOKEN;
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

describe("/metrics endpoint auth", () => {
  test("fails closed (404) when METRICS_TOKEN is not configured", async () => {
    delete process.env.METRICS_TOKEN;
    const res = await app.request("/metrics");
    expect(res.status).toBe(404);
  });

  test("returns 401 when token configured but no bearer provided", async () => {
    process.env.METRICS_TOKEN = "metrics-secret";
    const res = await app.request("/metrics");
    expect(res.status).toBe(401);
  });

  test("returns 401 on wrong bearer token", async () => {
    process.env.METRICS_TOKEN = "metrics-secret";
    const res = await app.request("/metrics", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  test("returns 200 with prometheus output on correct bearer token", async () => {
    process.env.METRICS_TOKEN = "metrics-secret";
    const res = await app.request("/metrics", {
      headers: { Authorization: "Bearer metrics-secret" },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("inkvoice_");
  });
});
