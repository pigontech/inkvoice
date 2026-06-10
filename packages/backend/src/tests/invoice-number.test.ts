import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { unlinkSync } from "node:fs";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { updateSettings } from "../services/settings.service";
import { resetEnvCache } from "../utils/env";
import {
  generateCreditNoteNumber,
  generateDraftNumber,
  generateInvoiceNumber,
  generateQuoteNumber,
  isDraftNumber,
} from "../utils/invoice-number";

const TEST_DB = "./data/test-invoice-number.db";

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "testpass123456";
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

describe("generateInvoiceNumber", () => {
  test("generates number matching default pattern", () => {
    const number = generateInvoiceNumber();
    const year = new Date().getFullYear();
    expect(number).toMatch(new RegExp(`^INV-${year}-\\d{4}$`));
  });

  test("sequential numbers increment after insertion", () => {
    const db = getDb();
    // Create a customer for FK
    const custId = crypto.randomBytes(16).toString("hex");
    db.run("INSERT INTO customers (id, name) VALUES (?, ?)", [custId, "Test"]);

    const num1 = generateInvoiceNumber();
    const invId = crypto.randomBytes(16).toString("hex");
    db.run(
      "INSERT INTO invoices (id, invoice_number, customer_id, status, issue_date) VALUES (?, ?, ?, 'draft', '2026-01-01')",
      [invId, num1, custId],
    );
    const num2 = generateInvoiceNumber();
    const seq1 = parseInt(num1.split("-").pop()!, 10);
    const seq2 = parseInt(num2.split("-").pop()!, 10);
    expect(seq2).toBe(seq1 + 1);

    db.run("DELETE FROM invoices WHERE id = ?", [invId]);
    db.run("DELETE FROM customers WHERE id = ?", [custId]);
  });

  test("includes year token", () => {
    const number = generateInvoiceNumber();
    expect(number).toContain(String(new Date().getFullYear()));
  });
});

describe("invoice-number pattern tokens", () => {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const yy = yyyy.slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");

  test("all date tokens substitute correctly", () => {
    updateSettings({ invoice_number_pattern: `T-{YYYY}{YY}{MM}{DD}-{SEQ4}` });
    const number = generateInvoiceNumber();
    expect(number).toMatch(new RegExp(`^T-${yyyy}${yy}${mm}${dd}-\\d{4}$`));
  });

  test("RAND4 token produces a 4-digit suffix", () => {
    updateSettings({ invoice_number_pattern: `R-{RAND4}` });
    const number = generateInvoiceNumber();
    expect(number).toMatch(/^R-\d{4}$/);
  });

  test("unpadded SEQ token (no digits)", () => {
    updateSettings({ invoice_number_pattern: `S-{SEQ}` });
    const number = generateInvoiceNumber();
    expect(number).toMatch(/^S-\d+$/);
  });

  test("SEQ6 zero-pads to 6 digits", () => {
    updateSettings({ invoice_number_pattern: `W-{YYYY}-{SEQ6}` });
    const number = generateInvoiceNumber();
    expect(number).toMatch(new RegExp(`^W-${yyyy}-\\d{6}$`));
  });
});

describe("sequence rollover and isolation", () => {
  test("sequence resets when prefix differs (e.g. year change)", () => {
    const db = getDb();
    // Pre-seed an invoice with last-year's prefix
    const custId = crypto.randomBytes(16).toString("hex");
    db.run("INSERT INTO customers (id, name) VALUES (?, ?)", [custId, "RolloverTest"]);
    const lastYear = new Date().getFullYear() - 1;
    const oldInvId = crypto.randomBytes(16).toString("hex");
    db.run(
      "INSERT INTO invoices (id, invoice_number, customer_id, status, issue_date) VALUES (?, ?, ?, 'draft', ?)",
      [oldInvId, `ROLL-${lastYear}-9999`, custId, `${lastYear}-12-31`],
    );

    updateSettings({ invoice_number_pattern: `ROLL-{YYYY}-{SEQ4}` });
    const number = generateInvoiceNumber();
    // Current year prefix has no prior matches → sequence starts at 1
    expect(number).toBe(`ROLL-${new Date().getFullYear()}-0001`);

    db.run("DELETE FROM invoices WHERE id = ?", [oldInvId]);
    db.run("DELETE FROM customers WHERE id = ?", [custId]);
  });
});

describe("draft and quote/credit-note numbers", () => {
  test("generateDraftNumber prefixed with DRAFT-", () => {
    const n = generateDraftNumber();
    expect(n).toMatch(/^DRAFT-[0-9a-f]{6}$/);
    expect(isDraftNumber(n)).toBe(true);
  });

  test("isDraftNumber distinguishes drafts from real numbers", () => {
    expect(isDraftNumber("DRAFT-abc123")).toBe(true);
    expect(isDraftNumber("INV-2026-0001")).toBe(false);
  });

  test("generateQuoteNumber and generateCreditNoteNumber follow their own sequences", () => {
    const q = generateQuoteNumber();
    const cn = generateCreditNoteNumber();
    expect(q).toMatch(/^QT-\d{4}-\d{4}$/);
    expect(cn).toMatch(/^CN-\d{4}-\d{4}$/);
  });
});
