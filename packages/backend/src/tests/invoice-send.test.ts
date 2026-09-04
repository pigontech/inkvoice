import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { unlinkSync } from "node:fs";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { createInvoice, finaliseForSending, getInvoice } from "../services/invoice.service";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-invoice-send.db";
let customerId: string;

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "invoicesendtestpass";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  resetEnvCache();
  initDatabase();
  runMigrations();
  await seed();
  customerId = crypto.randomBytes(16).toString("hex");
  getDb().run("INSERT INTO customers (id, name, email) VALUES (?, ?, ?)", [
    customerId,
    "Send Co",
    "billing@send.test",
  ]);
});

afterAll(() => {
  closeDatabase();
  for (const s of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + s);
    } catch {}
  }
});

function newDraft() {
  return createInvoice({
    customer_id: customerId,
    issue_date: "2026-09-04",
    currency: "USD",
    items: [{ description: "Work", quantity: 1, unit_price: 100 }],
  });
}

describe("finaliseForSending", () => {
  test("a draft becomes sent, published, and share-linked", () => {
    const inv = newDraft();
    expect(inv.status).toBe("draft");
    expect(inv.is_published).toBe(0);
    expect(inv.share_token).toBeNull();

    const finalised = finaliseForSending(inv.id)!;
    expect(finalised.status).toBe("sent");
    expect(finalised.is_published).toBe(1);
    expect(finalised.share_token).toBeTruthy();
    // It returns the post-write state, not the pre-write row the caller had.
    expect(finalised.invoice_number).toBe(getInvoice(inv.id)!.invoice_number);
  });

  test("it is idempotent and keeps the existing share token", () => {
    const inv = newDraft();
    const first = finaliseForSending(inv.id)!;
    const again = finaliseForSending(inv.id)!;
    expect(again.share_token).toBe(first.share_token);
    expect(again.invoice_number).toBe(first.invoice_number);
    expect(again.status).toBe("sent");
  });

  test("it leaves a paid invoice alone but still publishes it", () => {
    const inv = newDraft();
    finaliseForSending(inv.id);
    getDb().run("UPDATE invoices SET status = 'paid' WHERE id = ?", [inv.id]);
    const after = finaliseForSending(inv.id)!;
    expect(after.status).toBe("paid");
    expect(after.is_published).toBe(1);
  });

  test("it returns null for a missing invoice", () => {
    expect(finaliseForSending("nope")).toBeNull();
  });
});
