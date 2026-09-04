import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { unlinkSync } from "node:fs";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { createInvoice, finaliseForSending } from "../services/invoice.service";
import { resolvePublicOrigin, sendInvoiceEmail } from "../services/invoice-send.service";
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
    const draftPlaceholderNumber = inv.invoice_number;

    const finalised = finaliseForSending(inv.id)!;
    expect(finalised.status).toBe("sent");
    expect(finalised.is_published).toBe(1);
    expect(finalised.share_token).toBeTruthy();
    // It returns the post-write state, not the pre-write row the caller had.
    // markSent replaces the draft placeholder number with a real one, so this
    // only holds if the caller actually gets the re-read row.
    expect(finalised.invoice_number).not.toBe(draftPlaceholderNumber);
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
    // Construct a real "not draft, not published" invoice: paid, but with
    // publication rolled back as if it had never gone through the draft
    // branch. If the publish call ever moved inside the draft-only branch,
    // this invoice would stay unpublished and the assertions below would fail.
    getDb().run(
      "UPDATE invoices SET status = 'paid', is_published = 0, share_token = NULL WHERE id = ?",
      [inv.id],
    );
    const after = finaliseForSending(inv.id)!;
    expect(after.status).toBe("paid");
    expect(after.is_published).toBe(1);
    expect(after.share_token).toBeTruthy();
  });

  test("it returns null for a missing invoice", () => {
    expect(finaliseForSending("nope")).toBeNull();
  });
});

describe("resolvePublicOrigin", () => {
  test("prefers the request origin", () => {
    process.env.PUBLIC_BASE_URL = "https://env.example";
    resetEnvCache();
    expect(resolvePublicOrigin("https://req.example")).toBe("https://req.example");
  });

  test("falls back to PUBLIC_BASE_URL", () => {
    process.env.PUBLIC_BASE_URL = "https://env.example";
    resetEnvCache();
    expect(resolvePublicOrigin(undefined)).toBe("https://env.example");
  });

  test("returns empty string when neither is set", () => {
    process.env.PUBLIC_BASE_URL = "";
    resetEnvCache();
    expect(resolvePublicOrigin(undefined)).toBe("");
  });
});

describe("sendInvoiceEmail", () => {
  const previousSmtpHost = process.env.SMTP_HOST;

  beforeAll(() => {
    // isEmailConfigured() must resolve true here so these tests reach the
    // invoice/recipient checks, not the email-configured short circuit.
    // This only sets envSmtpConfig() to non-null, it never builds a
    // transporter or opens a network connection (that only happens via
    // getTransporterForActiveContext, which sendEmail calls, not
    // isEmailConfigured), so no real SMTP connection is attempted.
    process.env.SMTP_HOST = "smtp.test.invalid";
    resetEnvCache();
  });

  afterAll(() => {
    if (previousSmtpHost === undefined) {
      delete process.env.SMTP_HOST;
    } else {
      process.env.SMTP_HOST = previousSmtpHost;
    }
    resetEnvCache();
  });

  test("404s on a missing invoice", async () => {
    const result = await sendInvoiceEmail("nope");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.status).toBe(404);
  });

  test("400s when the customer has no email and none is supplied", async () => {
    const noEmailCustomer = crypto.randomBytes(16).toString("hex");
    getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [noEmailCustomer, "No Email Co"]);
    const inv = createInvoice({
      customer_id: noEmailCustomer,
      issue_date: "2026-09-04",
      currency: "USD",
      items: [{ description: "Work", quantity: 1, unit_price: 10 }],
    });
    const result = await sendInvoiceEmail(inv.id);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.status).toBe(400);
  });
});
