import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { getPaymentLayout } from "../services/accounting-export.formats";
import { attemptAutoBill } from "../services/auto-bill.service";
import { createCustomer } from "../services/customer.service";
import { createExpense } from "../services/expense.service";
import {
  createConsolidated,
  createCreditNote,
  createInvoice,
  getInvoice,
  markSent,
  updateInvoice,
} from "../services/invoice.service";
import { deletePayment, recordPayment } from "../services/payment.service";
import { paypalGateway } from "../services/payment-gateways/paypal.gateway";
import { renderInvoiceHtml } from "../services/pdf.service";
import { convertQuoteToInvoices, createQuote } from "../services/quote.service";
import { createRecurring, generateInvoice } from "../services/recurring.service";
import { chargeOffSession, createCheckoutSession } from "../services/stripe.service";
import { cashDiscountOn } from "../utils/cash-discount";
import { buildCsv } from "../utils/csv";
import { formatCurrency } from "../utils/currency";
import { resetEnvCache } from "../utils/env";
import { minorUnits, roundMoney } from "../utils/money";
import { calculateInvoiceTotals, calculateLineItemTaxInclusive } from "../utils/tax-calculator";
import { buildXmlInvoiceData } from "../xml/build-data";
import { getProfile, listProfiles } from "../xml/profile-registry";
import "../xml/init";

const dir = mkdtempSync(join(tmpdir(), "inkvoice-tnd-"));
let customerId: string;
const item = { description: "Millimes", quantity: 1, unit_price: 1.234, tax_rate: 0 };
const draft = (overrides = {}) =>
  createInvoice({
    customer_id: customerId,
    issue_date: "2026-09-18",
    currency: "TND",
    items: [item],
    ...overrides,
  });

beforeAll(async () => {
  process.env.DATABASE_PATH = join(dir, "invoice.db");
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "testpass123";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  resetEnvCache();
  initDatabase();
  runMigrations();
  await seed();
  customerId = createCustomer({ name: "TND test" }).id;
});
afterAll(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

test("TND calculation, discounts and inclusive tax retain millimes; EUR/USD retain cents", () => {
  expect(calculateInvoiceTotals([item], null, 0, { currency: "TND" }).total).toBe(1.234);
  for (const currency of ["USD", "EUR"])
    expect(calculateInvoiceTotals([item], null, 0, { currency }).total).toBe(1.23);
  expect(calculateInvoiceTotals([item], "amount", 0.001, { currency: "TND" }).total).toBe(1.233);
  expect(cashDiscountOn(1.234, { type: "percentage", value: 10, days: 10 }, "TND")).toBe(0.123);
  expect(
    calculateLineItemTaxInclusive({ ...item, unit_price: 1.469, tax_rate: 19 }, "TND"),
  ).toEqual({ line_total: 1.234, tax_amount: 0.235 });
});

test("create, reload, edit, tax definition, PDF and CSV preserve 1.234", () => {
  const inv = draft();
  expect(getInvoice(inv.id)?.total).toBe(1.234);
  expect(renderInvoiceHtml(inv.id)).toContain("1.234");
  expect(formatCurrency(1.234, "TND")).toContain("1.234");
  expect(buildCsv([inv], [{ header: "total", key: "total" }])).toContain("1.234");
  getDb().run("INSERT INTO tax_definitions (id, name, rate) VALUES ('tnd-tax', 'Tax', 19)");
  const updated = updateInvoice(inv.id, {
    customer_id: customerId,
    issue_date: inv.issue_date,
    currency: "TND",
    prices_include_tax: true,
    items: [{ ...item, unit_price: 1.469, tax_id: "tnd-tax", tax_rate: 19 }],
  })!;
  expect(updated.total).toBe(1.469);
  expect(updated.items[0].tax_amount).toBe(0.235);
  expect(updated.prices_include_tax).toBe(1);
});

test("one unpaid millime remains unpaid, then settles and payment deletion restores it", () => {
  const inv = draft();
  markSent(inv.id);
  expect(recordPayment(inv.id, { amount: 1.233, payment_date: inv.issue_date }).success).toBe(true);
  expect(getInvoice(inv.id)?.status).toBe("partially_paid");
  const last = recordPayment(inv.id, { amount: 0.001, payment_date: inv.issue_date });
  expect(last.success).toBe(true);
  expect(getInvoice(inv.id)?.status).toBe("paid");
  if (last.success) deletePayment(last.data.id);
  expect(getInvoice(inv.id)?.amount_paid).toBe(1.233);
  expect(getInvoice(inv.id)?.status).toBe("partially_paid");
});

test("cash discount rejects a one-millime mismatch and records the exact discount", () => {
  const inv = draft({
    cash_discount_type: "amount",
    cash_discount_value: 0.001,
    cash_discount_days: 10,
  });
  markSent(inv.id);
  expect(
    recordPayment(inv.id, {
      amount: 1.232,
      payment_date: inv.issue_date,
      apply_cash_discount: true,
    }).success,
  ).toBe(false);
  expect(
    recordPayment(inv.id, {
      amount: 1.233,
      payment_date: inv.issue_date,
      apply_cash_discount: true,
    }).success,
  ).toBe(true);
  expect(getInvoice(inv.id)?.cash_discount_applied).toBe(0.001);
  expect(getInvoice(inv.id)?.status).toBe("paid");
});

test("expenses, consolidation, credits and recurring invoices preserve TND", async () => {
  const expense = createExpense({ amount: 1.234, currency: "TND", tax_id: "tnd-tax" });
  expect(expense.total).toBe(1.468);
  const a = draft(),
    b = draft();
  expect(createConsolidated({ customer_id: customerId, invoice_ids: [a.id, b.id] }).total).toBe(
    2.468,
  );
  markSent(a.id);
  const credit = createCreditNote(a.id);
  expect(credit.success).toBe(true);
  if (credit.success) expect(credit.data.total).toBe(-1.234);
  const recurring = createRecurring({
    customer_id: customerId,
    template_invoice_id: b.id,
    frequency: "monthly",
    next_run_date: "2026-09-18",
  });
  const id = await generateInvoice(recurring.id);
  expect(getInvoice(id!)?.total).toBe(1.234);
});

test("instalments reconcile to the last millime", () => {
  const quote = createQuote({
    customer_id: customerId,
    issue_date: "2026-09-18",
    currency: "TND",
    items: [item],
  });
  const result = convertQuoteToInvoices(
    quote.id,
    [33.33, 33.33, 33.34].map((value) => ({ value, unit: "percent", due_offset_days: 0 })),
  );
  expect(result.success).toBe(true);
  if (result.success)
    expect(
      minorUnits(
        result.data.invoices.reduce((sum, i) => sum + i.total, 0),
        "TND",
      ),
    ).toBe(1234);
  expect(roundMoney(0.411 + 0.411 + 0.412, "TND")).toBe(1.234);
});

test("structured exports and online gateways reject TND before external work", async () => {
  const inv = draft();
  const xmlData = buildXmlInvoiceData(inv.id);
  for (const profile of listProfiles())
    expect(() => getProfile(profile.id)!.generateXml(xmlData)).toThrow("TND");
  expect(() =>
    buildCsv([{ amount: 1.234, currency: "TND" } as any], getPaymentLayout("xero").columns),
  ).toThrow("TND");
  const ctx = {
    invoiceId: inv.id,
    shareToken: "test",
    amount: inv.total,
    currency: "TND",
    customerEmail: null,
    successUrl: "https://example.com",
    cancelUrl: "https://example.com",
  };
  await expect(createCheckoutSession(ctx)).rejects.toThrow("TND");
  await expect(paypalGateway.createCheckout(ctx)).rejects.toThrow("TND");
  expect(
    (
      await chargeOffSession({
        ...ctx,
        gatewayCustomerId: "test",
        gatewayMethodId: "test",
        attemptNo: 1,
      })
    ).status,
  ).toBe("hard_failed");
  markSent(inv.id);
  expect((await attemptAutoBill(inv.id)).errorCode).toBe("unsupported_currency");
});
