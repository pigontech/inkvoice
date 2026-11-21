import { Database } from "bun:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { createServer, type Server } from "node:net";
import type { Hono } from "hono";
import { PDFDocument } from "pdf-lib";
import { createApp } from "../app";
import { accountInput, bankInput, contactInput, deliveryInput } from "../contracts/banking";
import { migrateBanking } from "../database/banking-migration";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import {
  defaultAccount,
  getBankingRecord,
  invoicePaymentDetails,
  listBanking,
  saveAccount,
  saveBank,
  saveContact,
} from "../services/banking.service";
import { createCustomer } from "../services/customer.service";
import * as emailService from "../services/email.service";
import {
  createInvoice,
  duplicateInvoice,
  getInvoice,
  markSent,
  updateInvoice,
} from "../services/invoice.service";
import { deliverInvoice, listDeliveries } from "../services/invoice-delivery.service";
import { closeInvoicePdfBrowser, invoicePdf } from "../services/invoice-pdf.service";
import { buildInvoiceContext, buildQuoteContext } from "../services/pdf.service";
import { createQuote } from "../services/quote.service";
import { updateSettings } from "../services/settings.service";
import { resetEnvCache } from "../utils/env";
import { signToken } from "../utils/jwt";

const TEST_DB = "./data/test-banking.db";
let customerId: string;
let app: Hono;
let token: string;
let server: Server;
let port: number;
const received: { recipients: string[]; content: string }[] = [];

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "banking-test-password";
  process.env.JWT_SECRET = "banking-tests-secret-that-is-at-least-32-chars";
  process.env.RATE_LIMIT_ENABLED = "false";
  resetEnvCache();
  initDatabase();
  runMigrations();
  await seed();
  customerId = createCustomer({ name: "Customer", email: "customer@example.com" }).id;
  app = createApp();
  const admin = getDb().query("SELECT id FROM users WHERE username = 'admin'").get() as {
    id: string;
  };
  token = await signToken({ sub: admin.id, username: "admin", is_admin: true });
  server = createServer((socket) => {
    let buffer = "";
    let content: string[] | null = null;
    let recipients: string[] = [];
    socket.write("220 local.test ESMTP\r\n");
    socket.on("data", (data) => {
      buffer += data.toString();
      let end = buffer.indexOf("\r\n");
      while (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (content) {
          if (line === ".") {
            received.push({ recipients: [...recipients], content: content.join("\r\n") });
            content = null;
            socket.write("250 accepted\r\n");
          } else content.push(line);
        } else if (line.startsWith("EHLO")) socket.write("250 local.test\r\n");
        else if (line.startsWith("MAIL FROM")) {
          recipients = [];
          socket.write("250 OK\r\n");
        } else if (line.startsWith("RCPT TO")) {
          const address = /<([^>]+)>/.exec(line)![1];
          if (address === "reject@example.com") socket.write("550 no such recipient\r\n");
          else {
            recipients.push(address);
            socket.write("250 OK\r\n");
          }
        } else if (line === "DATA") {
          content = [];
          socket.write("354 send data\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 OK\r\n");
        end = buffer.indexOf("\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});
afterEach(() => {
  emailService.setTenantSmtpResolver(null);
  received.length = 0;
});
afterAll(async () => {
  await closeInvoicePdfBrowser();
  server.close();
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});
function smtp() {
  emailService.setTenantSmtpResolver(async () => ({
    host: "127.0.0.1",
    port,
    secure: false,
    fromAddress: "sender@example.com",
  }));
}
function bank(name = "Test Bank") {
  return saveBank(bankInput.parse({ name }));
}
function account(bankId: string, overrides = {}) {
  return saveAccount(
    accountInput.parse({
      bank_id: bankId,
      label: "Operating",
      holder: "Company",
      account_number: "00123456789012345678",
      ...overrides,
    }),
  );
}
function contact(email: string, overrides = {}) {
  return saveContact(contactInput.parse({ name: "Contact", email, ...overrides }));
}
function draft(overrides = {}) {
  return createInvoice({
    customer_id: customerId,
    issue_date: "2026-10-30",
    currency: "TND",
    items: [{ description: "Services", quantity: 1, unit_price: 1.234 }],
    ...overrides,
  });
}
async function call(path: string, method: string, body?: unknown, auth = token, key?: string) {
  return app.request(`/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
      Origin: "https://invoice.example.com",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("banking contracts and snapshots", () => {
  test("contacts need no role and any contact can optionally link to a bank", async () => {
    const b = bank();
    const response = await call("/contacts", "POST", {
      name: "Alex",
      email: "alex@example.com",
      bank_id: b.id,
    });
    expect(response.status).toBe(201);
    const { data } = await response.json();
    expect(data.bank_id).toBe(b.id);
    expect(data).not.toHaveProperty("role");
    const updated = await call(`/contacts/${data.id}`, "PATCH", { bank_id: null });
    expect(updated.status).toBe(200);
    expect((await updated.json()).data.bank_id).toBeNull();
  });
  test("defaults are unique per currency, accounts keep leading zeros, and selection is currency-safe", () => {
    const b = bank();
    const a = account(b.id, { is_default: true });
    const eur = account(b.id, { currency: "EUR", is_default: true });
    expect(a.account_number).toStartWith("00");
    expect(defaultAccount("TND")).toBe(a.id);
    expect(draft().bank_account_id).toBe(a.id);
    expect(() => draft({ bank_account_id: eur.id })).toThrow("matching");
    const replacement = account(b.id, { is_default: true });
    expect(getBankingRecord("bank_accounts", a.id).is_default).toBe(false);
    expect(defaultAccount("EUR")).toBe(eur.id);
    expect(() => saveAccount({ ...replacement, archived: true }, replacement.id)).toThrow(
      "default",
    );
    saveAccount({ ...replacement, is_default: false, archived: true }, replacement.id);
    expect(() => draft({ bank_account_id: replacement.id })).toThrow("active");
    expect(() => saveBank({ ...b, archived: true }, b.id)).toThrow("accounts first");
  });
  test("drafts use live account details, issued invoices and all representations preserve their snapshot", () => {
    const b = bank("Banque & associés");
    const a = account(b.id);
    const invoice = draft({ bank_account_id: a.id });
    saveAccount({ ...a, holder: "Updated holder" }, a.id);
    expect(invoicePaymentDetails(invoice.id).holder).toBe("Updated holder");
    markSent(invoice.id);
    const before = invoicePaymentDetails(invoice.id);
    saveAccount({ ...a, holder: "Another holder", account_number: "999", archived: true }, a.id);
    expect(invoicePaymentDetails(invoice.id)).toEqual(before);
    expect(getInvoice(invoice.id)).not.toHaveProperty("bank_snapshot");
    expect(buildInvoiceContext(invoice.id)?.company.bank_details).toContain("00123456789012345678");
    expect(buildInvoiceContext(invoice.id)?.company.bank_details).toContain(
      "Banque &amp; associés",
    );
    expect(
      updateInvoice(invoice.id, {
        customer_id: customerId,
        issue_date: "2026-10-30",
        items: [],
        bank_account_id: null,
      }),
    ).toBeNull();
  });
  test("omitted draft edits retain selection, explicit null removes instructions, archived drafts cannot issue", () => {
    const a = account(bank().id);
    const invoice = draft({ bank_account_id: a.id });
    const data = {
      customer_id: customerId,
      issue_date: "2026-10-30",
      currency: "TND",
      items: [{ description: "Updated", quantity: 1, unit_price: 2 }],
    };
    expect(updateInvoice(invoice.id, data)?.bank_account_id).toBe(a.id);
    saveAccount({ ...a, archived: true }, a.id);
    expect(() => markSent(invoice.id)).toThrow("active");
    expect(getInvoice(invoice.id)?.status).toBe("draft");
    expect(
      updateInvoice(invoice.id, { ...data, bank_account_id: null })?.payment_details?.bank_details,
    ).toBe("");
    markSent(invoice.id);
    expect(buildInvoiceContext(invoice.id)?.company.bank_details).toBe("");
  });
  test("new and duplicated invoices use the default without changing quotes", () => {
    const a = account(bank().id, { is_default: true });
    const invoice = draft({ bank_account_id: null });
    expect(duplicateInvoice(invoice.id)?.bank_account_id).toBe(a.id);
    updateSettings({ company_bank_details: "Legacy quote instructions" });
    const quote = createQuote({
      customer_id: customerId,
      issue_date: "2026-10-30",
      items: [{ description: "Work", quantity: 1, unit_price: 1 }],
    });
    expect(buildQuoteContext(quote.id)?.company.bank_details).toBe("Legacy quote instructions");
  });
  test("PATCH retains omitted values and rejects bad input; contacts and bank lists paginate", async () => {
    const b = bank("Paging bank");
    const res = await call(`/banks/${b.id}`, "PATCH", { branch: "Tunis" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.name).toBe("Paging bank");
    expect(
      (await call("/contacts", "POST", { name: "Bad", role: "accountant", email: "bad" })).status,
    ).toBe(400);
    const c = contact("contact@example.com");
    const edit = await call(`/contacts/${c.id}`, "PATCH", { phone: "+216 12345678" });
    expect((await edit.json()).data.email).toBe(c.email);
    const list = listBanking("banks", { page: 1, limit: 1 });
    expect(list.items).toHaveLength(1);
    expect(list.totalPages).toBe(list.total);
    expect((await call("/banks?limit=101", "GET")).status).toBe(400);
    expect((await call("/banks/missing", "GET")).status).toBe(404);
  });
  test("non-admin readers cannot change banks, and cannot publish without invoice rights", async () => {
    getDb().run(
      "INSERT INTO users (id, username, password_hash, is_admin, is_active, role) VALUES ('bank-viewer', 'bank-viewer', '', 0, 1, 'Viewer')",
    );
    const viewer = await signToken({
      sub: "bank-viewer",
      username: "bank-viewer",
      is_admin: false,
    });
    expect((await call("/banks", "GET", undefined, viewer)).status).toBe(200);
    expect((await call("/banks", "POST", { name: "Unauthorized" }, viewer)).status).toBe(403);
    const invoice = draft();
    expect(
      (
        await call(
          `/invoices/${invoice.id}/deliveries`,
          "POST",
          { kind: "customer" },
          viewer,
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(403);
  });
  test("PDF uses the actual template and handles long multilingual invoices across pages", async () => {
    const a = account(bank("Banque de Tunis").id);
    const invoice = draft({
      bank_account_id: a.id,
      locale: "fr-FR",
      items: Array.from({ length: 85 }, (_, i) => ({
        description: `Conseil ${i} — العربية`,
        quantity: 1,
        unit_price: 1.234,
      })),
    });
    markSent(invoice.id);
    const pdf = await invoicePdf(invoice.id);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(1);
  }, 30000);
});

describe("delivery isolation and retry safety", () => {
  test("customer CC and private copies use separate SMTP envelopes, attachments, and a public link", async () => {
    smtp();
    const accountant = contact("accounts@example.com");
    const manager = contact("manager@example.com", { bank_id: bank().id });
    const invoice = draft();
    const input = deliveryInput.parse({
      kind: "customer",
      recipients: [
        { contact_id: manager.id, mode: "cc" },
        { contact_id: accountant.id, mode: "private" },
      ],
      message: "Please review <script>bad</script>",
    });
    const delivery = await deliverInvoice(
      invoice.id,
      input,
      crypto.randomUUID(),
      "test",
      "https://invoice.example.com",
    );
    expect(delivery.messages.map((m) => m.state)).toEqual(["accepted", "accepted"]);
    expect(received).toHaveLength(2);
    expect(received[0].recipients).toEqual(["customer@example.com", "manager@example.com"]);
    expect(received[1].recipients).toEqual(["accounts@example.com"]);
    expect(received[1].content).toContain("application/pdf");
    expect(received[1].content).toContain("/public/invoice/");
    expect(received[1].content).not.toContain("manager@example.com");
    expect(getInvoice(invoice.id)?.status).toBe("sent");
    saveContact({ ...accountant, email: "changed@example.com" }, accountant.id);
    expect(listDeliveries(invoice.id, 1, 20).items[0].messages[1].recipients[0].email).toBe(
      "accounts@example.com",
    );
  }, 30000);
  test("private sharing rejects drafts; issued private sharing publishes without mailing the customer", async () => {
    smtp();
    const c = contact("private@example.com");
    const invoice = draft();
    const input = deliveryInput.parse({
      kind: "private",
      recipients: [{ contact_id: c.id, mode: "private" }],
    });
    await expect(
      deliverInvoice(invoice.id, input, crypto.randomUUID(), "test", "https://invoice.example.com"),
    ).rejects.toThrow("issued");
    markSent(invoice.id);
    const delivery = await deliverInvoice(
      invoice.id,
      input,
      crypto.randomUUID(),
      "test",
      "https://invoice.example.com",
    );
    expect(delivery.messages[0].state).toBe("accepted");
    expect(received[0].recipients).toEqual([c.email]);
    expect(getInvoice(invoice.id)?.status).toBe("sent");
    expect(getInvoice(invoice.id)?.is_published).toBe(1);
  }, 30000);
  test("same intent replays without resending; changed payload fails; concurrent claim is rejected", async () => {
    smtp();
    const invoice = draft();
    const key = crypto.randomUUID();
    const input = deliveryInput.parse({ kind: "customer" });
    const first = deliverInvoice(invoice.id, input, key, "test", "https://invoice.example.com");
    await expect(
      deliverInvoice(invoice.id, input, key, "test", "https://invoice.example.com"),
    ).rejects.toThrow("progress");
    const sent = await first;
    expect(
      (await deliverInvoice(invoice.id, input, key, "test", "https://invoice.example.com")).id,
    ).toBe(sent.id);
    expect(received).toHaveLength(1);
    await expect(
      deliverInvoice(
        invoice.id,
        { ...input, subject: "Changed" },
        key,
        "test",
        "https://invoice.example.com",
      ),
    ).rejects.toThrow("different request");
  });
  test("partial CC rejection records accepted and rejected addresses, not a blanket success", async () => {
    smtp();
    const c = contact("reject@example.com");
    const invoice = draft();
    const delivery = await deliverInvoice(
      invoice.id,
      deliveryInput.parse({
        kind: "customer",
        recipients: [{ contact_id: c.id, mode: "cc" }],
      }),
      crypto.randomUUID(),
      "test",
      "https://invoice.example.com",
    );
    expect(delivery.messages[0].accepted).toEqual(["customer@example.com"]);
    expect(delivery.messages[0].rejected).toEqual(["reject@example.com"]);
    expect(delivery.messages[0].error).toBeTruthy();
  });
  test("an uncertain attempt is recorded and replayed without resending", async () => {
    smtp();
    const invoice = draft();
    const key = crypto.randomUUID();
    const input = deliveryInput.parse({ kind: "customer" });
    const send = spyOn(emailService, "sendEmail").mockResolvedValue({
      success: false,
      error: "Timed out",
      delivery_state: "unknown",
    });
    try {
      expect(
        (await deliverInvoice(invoice.id, input, key, "test", "https://invoice.example.com"))
          .messages[0].state,
      ).toBe("unknown");
      await deliverInvoice(invoice.id, input, key, "test", "https://invoice.example.com");
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      send.mockRestore();
    }
  });
  test("rejects duplicate recipients and archived contacts before issuing", async () => {
    smtp();
    const c = contact("duplicate@example.com");
    const invoice = draft();
    const input = deliveryInput.parse({
      kind: "customer",
      recipients: [
        { contact_id: c.id, mode: "cc" },
        { contact_id: c.id, mode: "private" },
      ],
    });
    await expect(
      deliverInvoice(invoice.id, input, crypto.randomUUID(), "test", "https://invoice.example.com"),
    ).rejects.toThrow("one copy");
    saveContact({ ...c, archived: true }, c.id);
    await expect(
      deliverInvoice(
        invoice.id,
        deliveryInput.parse({ ...input, recipients: [input.recipients[0]] }),
        crypto.randomUUID(),
        "test",
        "https://invoice.example.com",
      ),
    ).rejects.toThrow("archived");
    expect(getInvoice(invoice.id)?.status).toBe("draft");
    expect(received).toHaveLength(0);
  });
  test("missing keys and malformed recipients fail at the API boundary", async () => {
    const invoice = draft();
    expect(
      (await call(`/invoices/${invoice.id}/deliveries`, "POST", { kind: "customer" })).status,
    ).toBe(400);
    expect(
      (
        await call(
          `/invoices/${invoice.id}/deliveries`,
          "POST",
          { kind: "private", recipients: [{ contact_id: "x", mode: "cc" }] },
          token,
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(400);
  });
});

describe("migration from legacy banking", () => {
  for (const structured of [true, false])
    test(`preserves ${structured ? "structured" : "free-text"} instructions and existing invoices`, () => {
      const db = new Database(":memory:");
      try {
        db.exec(
          "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE invoices (id TEXT PRIMARY KEY, status TEXT); INSERT INTO invoices VALUES ('issued', 'sent'), ('draft', 'draft')",
        );
        db.run(
          "INSERT INTO settings VALUES ('company_bank_details', 'Old instructions'), ('company_iban', ?), ('currency', 'TND')",
          [structured ? "TN5900000000000000000000" : ""],
        );
        migrateBanking(db);
        expect(
          (db.query("SELECT COUNT(*) AS count FROM bank_accounts").get() as { count: number })
            .count,
        ).toBe(structured ? 1 : 0);
        const row = db.query("SELECT bank_snapshot FROM invoices WHERE id = 'issued'").get() as {
          bank_snapshot: string;
        };
        expect(JSON.parse(row.bank_snapshot).bank_details).toBe("Old instructions");
        expect(
          (
            db.query("SELECT bank_snapshot FROM invoices WHERE id = 'draft'").get() as {
              bank_snapshot: string | null;
            }
          ).bank_snapshot,
        ).toBeNull();
        migrateBanking(db);
        expect(
          (db.query("SELECT COUNT(*) AS count FROM banks").get() as { count: number }).count,
        ).toBe(structured ? 1 : 0);
      } finally {
        db.close();
      }
    });
});

test("backup preserves banking and delivery records and wipe removes them safely", async () => {
  const tables = [
    "banks",
    "bank_accounts",
    "contacts",
    "invoice_delivery_requests",
    "invoice_delivery_messages",
  ];
  const response = await call("/export/backup", "GET");
  expect(response.status).toBe(200);
  const backup = await response.json();
  for (const table of tables) {
    expect(backup.data[table].length).toBeGreaterThan(0);
    const count = getDb().query(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    };
    expect(backup.data[table]).toHaveLength(count.count);
  }
  expect((await call("/export/wipe", "POST", { confirm: "DELETE" })).status).toBe(200);
  for (const table of tables) {
    const count = getDb().query(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    };
    expect(count.count).toBe(0);
  }
  expect(getDb().query("SELECT id FROM users WHERE username = 'admin'").get()).not.toBeNull();
});
