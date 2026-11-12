import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { createCustomer } from "../services/customer.service";
import { createCreditNote, createInvoice, markSent } from "../services/invoice.service";
import { buildInvoiceContext, renderInvoiceHtml } from "../services/pdf.service";
import { resetEnvCache } from "../utils/env";

// A credit note made from an invoice reverses that invoice: same lines, same
// document discount, same exchange rate, so its totals mirror the invoice's.

const TEST_DB = "./data/test-credit-note-totals.db";
let customerId = "";

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "testpass123";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  resetEnvCache();
  initDatabase();
  runMigrations();
  await seed();
  customerId = createCustomer({ name: "Credit Customer" }).id;
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
});

function creditFor(data: Partial<Parameters<typeof createInvoice>[0]>) {
  const inv = createInvoice({
    customer_id: customerId,
    issue_date: "2026-11-01",
    items: [{ description: "Consulting", quantity: 10, unit_price: 100, tax_rate: 20 }],
    ...data,
  });
  markSent(inv.id);
  const credit = createCreditNote(inv.id);
  if (!credit.success) throw new Error(credit.error);
  return { inv, credit: credit.data };
}

describe("credit note totals", () => {
  test("a percentage discount on the invoice is reversed too", () => {
    const { inv, credit } = creditFor({ discount_type: "percentage", discount_value: 10 });
    expect(inv.total).toBe(1080);
    expect(credit.discount_type).toBe("percentage");
    expect(credit.discount_value).toBe(10);
    expect(credit.subtotal).toBe(-1000);
    expect(credit.discount_amount).toBe(-100);
    expect(credit.tax_total).toBe(-180);
    expect(credit.total).toBe(-1080);
  });

  test("a fixed discount on the invoice is reversed too", () => {
    const { inv, credit } = creditFor({ discount_type: "amount", discount_value: 150 });
    expect(inv.total).toBe(1020);
    expect(credit.discount_amount).toBe(-150);
    expect(credit.tax_total).toBe(-170);
    expect(credit.total).toBe(-1020);
  });

  test("a fixed discount above the subtotal is capped the same way", () => {
    const { inv, credit } = creditFor({ discount_type: "amount", discount_value: 5000 });
    expect(inv.total).toBe(0);
    expect(credit.discount_amount).toBe(-1000);
    expect(credit.total).toBe(0);
  });

  test("an invoice without a discount gives the plain reverse", () => {
    const { inv, credit } = creditFor({});
    expect(inv.total).toBe(1200);
    expect(credit.discount_amount).toBe(0);
    expect(credit.total).toBe(-1200);
  });

  test("the credit note keeps the invoice's exchange rate", () => {
    const { inv, credit } = creditFor({ currency: "EUR", exchange_rate: 1.08 });
    expect(inv.exchange_rate).toBe(1.08);
    expect(credit.currency).toBe("EUR");
    expect(credit.exchange_rate).toBe(1.08);
  });

  test("the print PDF shows a credit note's discount as a plus so the totals add up", () => {
    const { inv, credit } = creditFor({ discount_type: "percentage", discount_value: 10 });
    const invoiceCtx = buildInvoiceContext(inv.id)!;
    const creditCtx = buildInvoiceContext(credit.id)!;
    expect(invoiceCtx.has_discount).toBe(true);
    expect(invoiceCtx.has_credit_discount).toBe(false);
    expect(creditCtx.has_discount).toBe(false);
    expect(creditCtx.has_credit_discount).toBe(true);

    const html = renderInvoiceHtml(credit.id)!;
    expect(html).toContain(`+${creditCtx.formatted_discount}`);
    // Visible lines must add up: -1,000 + 100 - 180 = -1,080.
    expect(html).toContain(creditCtx.formatted_subtotal);
    expect(html).toContain(creditCtx.formatted_total);
  });
});
