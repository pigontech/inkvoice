import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { invoiceDeliveryEmail } from "../services/email-templates";
import { updateSettings } from "../services/settings.service";
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

  test("does not HTML-escape {{public_url}} or special characters in custom subject/body", () => {
    updateSettings({
      invoice_email_subject: "Invoice {{invoice_number}} from {{company_name}}",
      invoice_email_body:
        "Hi {{customer_name}},\n\nView it online at {{public_url}}.\n{{{public_url}}}",
    });

    try {
      const result = invoiceDeliveryEmail({
        company_name: "Smith & Sons",
        customer_name: "Jane <Accounting>",
        invoice_number: "INV-2026-042",
        total: "1.234,56 €",
        currency: "EUR",
        due_date: "26.11.2026",
        public_url: "https://example.com/public/invoice/abc123",
      });

      // Subject and plain-text body are plain text — never HTML-encoded.
      expect(result.subject).toBe("Invoice INV-2026-042 from Smith & Sons");
      expect(result.text).toContain("View it online at https://example.com/public/invoice/abc123.");
      expect(result.text).not.toContain("&#x2F;");
      expect(result.text).toContain("Hi Jane <Accounting>,");

      // HTML body preserves slashes in URLs while still escaping <, >, & once.
      expect(result.html).toContain("View it online at https://example.com/public/invoice/abc123.");
      expect(result.html).not.toContain("&#x2F;");
      expect(result.html).not.toContain("&amp;#x2F;");
      expect(result.html).toContain("Hi Jane &lt;Accounting&gt;,");
    } finally {
      updateSettings({ invoice_email_subject: "", invoice_email_body: "" });
    }
  });
});
