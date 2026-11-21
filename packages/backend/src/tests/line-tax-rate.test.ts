import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { unlinkSync } from "node:fs";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { createInvoice, updateInvoice } from "../services/invoice.service";
import { createQuote, updateQuote } from "../services/quote.service";
import { resetEnvCache } from "../utils/env";

// A line sent with its tax definition but without a rate (an API client) is
// stored and totalled at the definition's rate. Totals and lines always use
// the same rate.

const TEST_DB = "./data/test-line-tax-rate.db";
let customerId: string;
let vat19: string;

beforeAll(() => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  resetEnvCache();
  initDatabase();
  runMigrations();
  customerId = crypto.randomBytes(16).toString("hex");
  getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [customerId, "Kunde GmbH"]);
  vat19 = crypto.randomBytes(16).toString("hex");
  getDb().run(
    "INSERT INTO tax_definitions (id, name, rate, category_code, is_default, is_active) VALUES (?, ?, ?, ?, 0, 1)",
    [vat19, "USt 19 %", 19, "S"],
  );
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

const doc = (items: { tax_id?: string; tax_rate?: number }[]) => ({
  customer_id: customerId,
  issue_date: "2026-11-07",
  items: items.map((tax) => ({ description: "Beratung", quantity: 2, unit_price: 50, ...tax })),
});

describe("line tax rate", () => {
  test("an invoice line with only a tax definition is taxed at its rate", () => {
    const created = createInvoice(doc([{ tax_id: vat19 }]));
    expect(created.items[0].tax_rate).toBe(19);
    expect(created.tax_total).toBe(19);
    expect(created.total).toBe(119);

    const updated = updateInvoice(created.id, doc([{ tax_id: vat19 }]));
    expect(updated?.items[0].tax_rate).toBe(19);
    expect(updated?.tax_total).toBe(19);
  });

  test("an invoice edit keeps the rate sent with the line", () => {
    const created = createInvoice(doc([{ tax_id: vat19, tax_rate: 19 }]));
    const updated = updateInvoice(created.id, doc([{ tax_id: vat19, tax_rate: 16 }]));
    expect(updated?.items[0].tax_rate).toBe(16);
    expect(updated?.tax_total).toBe(16);
  });

  test("a quote line with only a tax definition is taxed at its rate", () => {
    const created = createQuote(doc([{ tax_id: vat19 }]));
    expect(created.tax_total).toBe(19);
    expect(created.total).toBe(119);

    const updated = updateQuote(created.id, doc([{ tax_id: vat19 }]));
    expect(updated?.tax_total).toBe(19);
  });
});
