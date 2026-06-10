import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-accounting-export.db";
let app: Hono;
let token: string;
let invoiceNumber: string;

async function authed(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    ...((opts.headers as Record<string, string>) || {}),
    Authorization: `Bearer ${token}`,
  };
  if (opts.method && opts.method !== "GET") headers["Content-Type"] = "application/json";
  return app.request(new Request(`http://localhost${path}`, { ...opts, headers }));
}

/** Split a CSV body (RFC-4180 CRLF lines) and drop the trailing blank, if any. */
function csvLines(body: string): string[] {
  return body.split("\r\n").filter((l) => l.length > 0);
}

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "testpass123";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  process.env.RATE_LIMIT_ENABLED = "false";
  resetEnvCache();

  initDatabase();
  runMigrations();
  await seed();
  app = createApp();

  const login = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "testpass123" }),
  });
  token = ((await login.json()) as any).data.token;

  // Customer with an address (Xero exports the PO* address columns).
  const custRes = await authed("/api/v1/customers", {
    method: "POST",
    body: JSON.stringify({
      name: "Acme Test Co",
      email: "billing@acme.test",
      city: "Berlin",
      country: "DE",
    }),
  });
  const customerId = ((await custRes.json()) as any).data.id;

  // Invoice with two line items → exercises line-item-per-row export.
  const invRes = await authed("/api/v1/invoices", {
    method: "POST",
    body: JSON.stringify({
      customer_id: customerId,
      issue_date: "2026-03-15",
      currency: "USD",
      items: [
        { description: "Consulting", quantity: 2, unit_price: 100 },
        { description: "Setup fee", quantity: 1, unit_price: 50 },
      ],
    }),
  });
  const invoice = ((await invRes.json()) as any).data;

  // Finalize it (drafts are excluded from the accounting export) and record a payment.
  // mark-sent assigns the final invoice number, so read it back afterwards.
  const sent = await authed(`/api/v1/invoices/${invoice.id}/mark-sent`, { method: "POST" });
  expect(sent.status).toBe(200);
  const finalized = await authed(`/api/v1/invoices/${invoice.id}`);
  invoiceNumber = ((await finalized.json()) as any).data.invoice_number;
  await authed(`/api/v1/invoices/${invoice.id}/payments`, {
    method: "POST",
    body: JSON.stringify({
      amount: 50,
      payment_date: "2026-03-20",
      method: "bank_transfer",
      reference: "TXN-1",
    }),
  });

  // An expense → exercises the bills/purchases export.
  await authed("/api/v1/expenses", {
    method: "POST",
    body: JSON.stringify({
      vendor: "AWS",
      category: "Hosting",
      description: "Hosting",
      expense_date: "2026-03-10",
      amount: 80,
    }),
  });
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
});

const RANGE = "date_from=2026-01-01&date_to=2026-12-31";

describe("Accounting export — invoices", () => {
  test("Xero layout: line-item-per-row with the expected header", async () => {
    const res = await authed(
      `/api/v1/reports/accounting-export/csv?format=xero&dataset=invoices&${RANGE}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("invoices-xero");

    const lines = csvLines(await res.text());
    expect(lines[0]).toBe(
      "ContactName,EmailAddress,POAddressLine1,POCity,PORegion,POPostalCode,POCountry,InvoiceNumber,Reference,InvoiceDate,DueDate,Description,Quantity,UnitAmount,AccountCode,TaxType,TaxAmount,Currency",
    );
    const dataRows = lines.slice(1).filter((l) => l.includes(invoiceNumber));
    expect(dataRows.length).toBe(2); // two line items
    expect(dataRows.some((r) => r.includes("Consulting"))).toBe(true);
    expect(dataRows.some((r) => r.includes("Setup fee"))).toBe(true);
    // Defaults: sales account 200, tax-exempt, native currency, customer email.
    expect(dataRows[0]).toContain("billing@acme.test");
    expect(dataRows[0]).toContain(",200,");
    expect(dataRows[0]).toContain("Tax Exempt");
    expect(dataRows[0]).toContain("USD");
  });

  test("QuickBooks layout header + amounts", async () => {
    const res = await authed(
      `/api/v1/reports/accounting-export/csv?format=quickbooks&dataset=invoices&${RANGE}`,
    );
    const lines = csvLines(await res.text());
    expect(lines[0]).toBe(
      "InvoiceNo,Customer,InvoiceDate,DueDate,Item(Product/Service),ItemDescription,ItemQuantity,ItemRate,ItemAmount,Currency,Taxable,TaxRate",
    );
    const dataRows = lines.slice(1).filter((l) => l.includes(invoiceNumber));
    expect(dataRows.length).toBe(2);
    expect(dataRows.some((r) => r.includes("Consulting") && r.includes("200.00"))).toBe(true);
  });

  test("date range excludes out-of-range invoices", async () => {
    const res = await authed(
      `/api/v1/reports/accounting-export/csv?format=xero&dataset=invoices&date_from=2025-01-01&date_to=2025-12-31`,
    );
    const lines = csvLines(await res.text());
    expect(lines.length).toBe(1); // header only
  });

  test("defaults to Xero invoices when format/dataset omitted", async () => {
    const res = await authed(`/api/v1/reports/accounting-export/csv?${RANGE}`);
    const lines = csvLines(await res.text());
    expect(lines[0]).toContain("ContactName");
    expect(lines[0]).toContain("InvoiceNumber");
  });
});

describe("Accounting export — payments", () => {
  test("Xero bank-statement layout", async () => {
    const res = await authed(
      `/api/v1/reports/accounting-export/csv?format=xero&dataset=payments&${RANGE}`,
    );
    const lines = csvLines(await res.text());
    expect(lines[0]).toBe("Date,Amount,Payee,Description,Reference");
    const row = lines.find((l) => l.includes("TXN-1"));
    expect(row).toBeDefined();
    expect(row).toContain("50.00");
    expect(row).toContain("Acme Test Co");
    expect(row).toContain(`Invoice ${invoiceNumber}`);
  });

  test("QuickBooks bank-transaction layout", async () => {
    const res = await authed(
      `/api/v1/reports/accounting-export/csv?format=quickbooks&dataset=payments&${RANGE}`,
    );
    const lines = csvLines(await res.text());
    expect(lines[0]).toBe("Date,Description,Amount");
    const row = lines.find((l) => l.includes(invoiceNumber));
    expect(row).toContain("50.00");
    expect(row).toContain("Acme Test Co");
  });
});

describe("Accounting export — expenses", () => {
  test("Xero bills layout with expense account default", async () => {
    const res = await authed(
      `/api/v1/reports/accounting-export/csv?format=xero&dataset=expenses&${RANGE}`,
    );
    const lines = csvLines(await res.text());
    expect(lines[0]).toBe(
      "ContactName,InvoiceNumber,InvoiceDate,DueDate,Description,Quantity,UnitAmount,AccountCode,TaxType,TaxAmount,Currency",
    );
    const row = lines.find((l) => l.includes("AWS"));
    expect(row).toBeDefined();
    expect(row).toContain("Hosting");
    expect(row).toContain(",400,"); // expense account default
  });

  test("QuickBooks bills layout maps category to Account", async () => {
    const res = await authed(
      `/api/v1/reports/accounting-export/csv?format=quickbooks&dataset=expenses&${RANGE}`,
    );
    const lines = csvLines(await res.text());
    expect(lines[0]).toBe(
      "BillNo,Supplier,BillDate,DueDate,Account,LineDescription,LineAmount,Currency",
    );
    const row = lines.find((l) => l.includes("AWS"));
    expect(row).toContain("Hosting"); // category → Account
    expect(row).toContain("Hosting"); // description → LineDescription
  });
});
