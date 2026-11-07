import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import Mustache from "mustache";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { readTemplateFile } from "../services/builtin-templates";
import { createCustomer } from "../services/customer.service";
import { createInvoice } from "../services/invoice.service";
import { buildInvoiceContext } from "../services/pdf.service";
import { updateSettings } from "../services/settings.service";
import { resetEnvCache } from "../utils/env";
import { regionalColumns, toNzTerms } from "../utils/region-terms";

const TEST_DB = "./data/test-nz-region.db";

let customerId: string;

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
  customerId = createCustomer({ name: "Kiwi Ltd", tax_id: "123-456-789" }).id;
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
});

beforeEach(() => {
  updateSettings({
    locale: "en-NZ",
    date_format: "DD-MM-YYYY",
    company_tax_id: "987-654-321",
    company_account_number: "12-3456-7890123-00",
    company_bank_details: "ANZ",
  });
});

function nzInvoiceContext() {
  const invoice = createInvoice({
    customer_id: customerId,
    issue_date: "2026-03-31",
    currency: "NZD",
    items: [{ description: "Consulting", quantity: 1, unit_price: 100, tax_rate: 15 }],
  });
  return buildInvoiceContext(invoice.id)!;
}

describe("NZ wording helpers", () => {
  test("toNzTerms swaps tax wording for GST wording", () => {
    expect(toNzTerms("Tax ID")).toBe("GST Number");
    expect(toNzTerms("Taxable Amount")).toBe("Amount excl. GST");
    expect(toNzTerms("Tax Collected")).toBe("GST Collected");
    expect(toNzTerms("Fiscal Year")).toBe("Financial Year");
  });

  test("regionalColumns only renames headers for NZ businesses", () => {
    const cols = [{ header: "Tax", key: "tax_total" as const }];
    expect(regionalColumns(cols, { locale: "en-NZ" })[0].header).toBe("GST");
    expect(regionalColumns(cols, { locale: "en-US" })[0].header).toBe("Tax");
  });
});

describe("NZ invoice rendering", () => {
  test("dates use DD-MM-YYYY and the account number leads the bank details", () => {
    const ctx = nzInvoiceContext();
    expect(ctx.issue_date).toBe("31-03-2026");
    expect(ctx.nz).toBe(true);
    expect(ctx.company.bank_details).toBe("Account number: 12-3456-7890123-00<br>ANZ");
  });

  test("built-in template prints GST wording, never Tax/VAT ID", () => {
    const html = Mustache.render(readTemplateFile("template-inkvoice.html"), nzInvoiceContext());
    expect(html).toContain("GST No.: 987-654-321");
    expect(html).toContain("Customer GST No.: 123-456-789");
    expect(html).toContain("Total (excl. GST)");
    expect(html).not.toContain("VAT ID");
    expect(html).not.toContain("Sales tax");
  });

  test("non-NZ businesses keep their existing wording", () => {
    updateSettings({ locale: "en-US" });
    const html = Mustache.render(readTemplateFile("template-inkvoice.html"), nzInvoiceContext());
    expect(html).toContain("VAT ID: 987-654-321");
    expect(html).toContain("Sales tax");
  });
});
