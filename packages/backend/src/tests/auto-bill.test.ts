import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { unlinkSync } from "node:fs";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import {
  isStripeConfigured,
  setStripeClientResolver,
  setStripeConfiguredChecker,
} from "../services/stripe.service";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-auto-bill.db";
let customerId: string;

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "autobilltestpass";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  resetEnvCache();

  initDatabase();
  runMigrations();
  await seed();

  customerId = crypto.randomBytes(16).toString("hex");
  getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [customerId, "Billing Co"]);
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

describe("stripe client resolution", () => {
  afterEach(() => {
    setStripeClientResolver(null);
    setStripeConfiguredChecker(null);
  });

  test("isStripeConfigured defers to a registered checker", () => {
    setStripeConfiguredChecker(() => true);
    expect(isStripeConfigured()).toBe(true);
    setStripeConfiguredChecker(() => false);
    expect(isStripeConfigured()).toBe(false);
  });

  test("without a checker it falls back to env", () => {
    // Neither STRIPE_SECRET_KEY nor STRIPE_WEBHOOK_SECRET is set in this suite.
    expect(isStripeConfigured()).toBe(false);
  });
});
