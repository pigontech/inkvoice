import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";
import crypto from "node:crypto";
import { unlinkSync } from "node:fs";
import nodemailer from "nodemailer";
import { createApp } from "../app";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import * as emailService from "../services/email.service";
import { setTenantSmtpResolver } from "../services/email.service";
import { createInvoice, finaliseForSending } from "../services/invoice.service";
import { resolvePublicOrigin, sendInvoiceEmail } from "../services/invoice-send.service";
import { createQuote } from "../services/quote.service";
import { updateSettings } from "../services/settings.service";
import { resetEnvCache } from "../utils/env";
import { signToken } from "../utils/jwt";

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
    expect(result).toEqual({ success: false, error: "Invoice not found", status: 404 });
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
    expect(result).toEqual({ success: false, error: "No recipient email address", status: 400 });
  });

  test("formats {{total}} and {{due_date}} using customer language and configured number/date formats", async () => {
    const sent: Array<{ subject: string; html: string; text?: string }> = [];
    const realEmail = { ...emailService };
    mock.module("../services/email.service", () => ({
      ...realEmail,
      isEmailConfigured: async () => true,
      sendEmail: async (opts: Parameters<typeof emailService.sendEmail>[0]) => {
        sent.push({ subject: opts.subject, html: opts.html, text: opts.text });
        return { success: true as const };
      },
    }));

    try {
      updateSettings({
        number_format: "1.000,00",
        date_format: "DD.MM.YYYY",
        invoice_email_subject: "Rechnung {{invoice_number}}",
        invoice_email_body: "Gesamt: {{total}} — Fällig: {{due_date}}",
      });

      const deCustomer = crypto.randomBytes(16).toString("hex");
      getDb().run("INSERT INTO customers (id, name, email, language) VALUES (?, ?, ?, ?)", [
        deCustomer,
        "Kunde GmbH",
        "kunde@example.de",
        "de-DE",
      ]);
      const inv = createInvoice({
        customer_id: deCustomer,
        issue_date: "2026-11-12",
        due_date: "2026-11-26",
        currency: "EUR",
        items: [{ description: "Beratung", quantity: 1, unit_price: 1234.56 }],
      });

      const res = await sendInvoiceEmail(inv.id, { origin: "https://billing.example.com" });
      expect(res.success).toBe(true);
      expect(sent.length).toBe(1);
      expect(sent[0].text).toContain("1.234,56\u00a0€");
      expect(sent[0].text).toContain("26.11.2026");

      // Also works via number_format alone when customer has no language set.
      sent.length = 0;
      const plainInv = createInvoice({
        customer_id: customerId,
        issue_date: "2026-11-12",
        due_date: "2026-11-26",
        currency: "EUR",
        items: [{ description: "Beratung", quantity: 1, unit_price: 1234.56 }],
      });
      const res2 = await sendInvoiceEmail(plainInv.id, { origin: "https://billing.example.com" });
      expect(res2.success).toBe(true);
      expect(sent[0].text).toContain("1.234,56\u00a0€");
      expect(sent[0].text).toContain("26.11.2026");
    } finally {
      mock.module("../services/email.service", () => realEmail);
      updateSettings({
        number_format: "1,000.00",
        date_format: "YYYY-MM-DD",
        invoice_email_subject: "",
        invoice_email_body: "",
      });
    }
  });
});

describe("CC recipients", () => {
  for (const resource of ["invoices"] as const) {
    async function draftAndRequest(cc: unknown) {
      const create = resource === "invoices" ? createInvoice : createQuote;
      const draft = create({
        customer_id: customerId,
        issue_date: "2026-09-04",
        items: [{ description: "Work", quantity: 1, unit_price: 100 }],
      });
      const admin = getDb().query("SELECT id FROM users WHERE username = 'admin'").get() as {
        id: string;
      };
      const token = await signToken({ sub: admin.id, username: "admin", is_admin: true });
      const response = await createApp().request(`/api/v1/${resource}/${draft.id}/send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ cc }),
      });
      return { draft, response };
    }

    test.each([
      ["one recipient", ["copy@example.com"], ["copy@example.com"]],
      [
        "multiple recipients with whitespace",
        [" copy@example.com ", "accounts@example.com"],
        ["copy@example.com", "accounts@example.com"],
      ],
      ["omitted CC", undefined, undefined],
      ["empty CC", [], []],
    ])(`${resource}: delivers with %s`, async (_label, cc, expected) => {
      const transport = nodemailer.createTransport({ jsonTransport: true });
      const createTransport = spyOn(nodemailer, "createTransport").mockReturnValue(transport);
      const sendMail = spyOn(transport, "sendMail");
      setTenantSmtpResolver(async () => ({
        host: "smtp.test.invalid",
        port: 465,
        secure: true,
        fromAddress: "billing@example.com",
      }));
      try {
        const { response } = await draftAndRequest(cc);
        expect(response.status).toBe(200);
        expect(sendMail).toHaveBeenCalledTimes(1);
        expect(sendMail.mock.calls[0][0]).toMatchObject({ to: "billing@send.test", cc: expected });
      } finally {
        sendMail.mockRestore();
        createTransport.mockRestore();
        setTenantSmtpResolver(null);
        transport.close();
      }
    });

    test.each([
      ["malformed address", ["not-an-email"]],
      ["mixed valid and invalid addresses", ["copy@example.com", "bad"]],
      ["header injection", ["copy@example.com\r\nBcc: hidden@example.com"]],
      ["string instead of array", "copy@example.com"],
      ["non-string recipient", [42]],
      ["null", null],
    ])(`${resource}: rejects %s without publishing`, async (_label, cc) => {
      const { draft, response } = await draftAndRequest(cc);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
      expect(
        getDb().query(`SELECT status, is_published FROM ${resource} WHERE id = ?`).get(draft.id),
      ).toEqual({ status: "draft", is_published: 0 });
    });
  }
});
