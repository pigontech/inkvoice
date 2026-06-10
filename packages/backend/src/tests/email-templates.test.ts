import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { invoiceDeliveryEmail } from "../services/email-templates";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-email-templates.db";

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  resetEnvCache();
  initDatabase();
  runMigrations();
  await seed();
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

describe("invoiceDeliveryEmail", () => {
  test("generates subject, html, and text", () => {
    const result = invoiceDeliveryEmail({
      company_name: "Acme Inc",
      customer_name: "John Doe",
      invoice_number: "INV-2026-001",
      total: "$1,500.00",
      currency: "USD",
      due_date: "2026-05-01",
      public_url: "https://example.com/public/invoice/abc123",
    });

    expect(result.subject).toContain("INV-2026-001");
    expect(result.html).toContain("INV-2026-001");
    expect(result.html).toContain("John Doe");
    expect(result.html).toContain("$1,500.00");
    expect(result.html).toContain("https://example.com/public/invoice/abc123");
    expect(result.text).toContain("INV-2026-001");
    expect(result.text).toContain("John Doe");
  });

  test("handles missing public_url", () => {
    const result = invoiceDeliveryEmail({
      company_name: "Acme Inc",
      customer_name: "Jane",
      invoice_number: "INV-001",
      total: "$100",
      currency: "USD",
      due_date: null,
      public_url: null,
    });

    expect(result.html).not.toContain("View Invoice");
    expect(result.text).not.toContain("View invoice:");
  });

  test("includes custom message", () => {
    const result = invoiceDeliveryEmail({
      company_name: "Acme Inc",
      customer_name: "Jane",
      invoice_number: "INV-001",
      total: "$100",
      currency: "USD",
      due_date: null,
      public_url: null,
      custom_message: "Please pay within 7 days",
    });

    expect(result.html).toContain("Please pay within 7 days");
    expect(result.text).toContain("Please pay within 7 days");
  });
});
