import type { CsvColumn } from "../utils/csv";
import type {
  ExpenseExportRow,
  InvoiceExportRow,
  PaymentExportRow,
} from "./accounting-export.service";

/**
 * Column layouts that map normalized accounting-export rows onto each target's
 * import template. Both QuickBooks Online and Xero ingest line-item-per-row CSVs;
 * the difference is header names, field selection and a couple of derived columns.
 *
 * Defaults are deliberately conservative: amounts are native (with a Currency
 * column), dates are ISO, and Xero's required AccountCode/TaxType use safe
 * org-wide defaults the accountant adjusts on import (see docs/features/accounting-export.md).
 */

export type ExportFormat = "xero" | "quickbooks";
export type ExportDataset = "invoices" | "payments" | "expenses";

export const EXPORT_FORMATS: readonly ExportFormat[] = ["xero", "quickbooks"];
export const EXPORT_DATASETS: readonly ExportDataset[] = ["invoices", "payments", "expenses"];

export interface FormatOptions {
  /** Xero sales account code for invoice lines (default "200"). */
  salesAccount: string;
  /** Xero expense account code for bill lines (default "400"). */
  expenseAccount: string;
}

export interface ExportLayout<T> {
  columns: CsvColumn<T>[];
  filenameStem: string;
}

// --- shared formatters ---------------------------------------------------

const money = (v: unknown): string =>
  v === null || v === undefined || v === "" ? "" : Number(v).toFixed(2);

const qty = (v: unknown): string =>
  v === null || v === undefined || v === "" ? "" : String(Number(v));

const taxableYN = (v: unknown): string => (Number(v) > 0 ? "Y" : "N");

const xeroTaxType =
  (kind: "sales" | "purchases") =>
  (v: unknown): string => {
    if (!Number(v)) return "Tax Exempt";
    return kind === "sales" ? "Tax on Sales" : "Tax on Purchases";
  };

const expenseDescription = (_v: unknown, row: ExpenseExportRow): string =>
  row.description || row.category || row.vendor || "Expense";

/** A constant-valued column (its value ignores the row). Keyed on `currency`,
 *  which every export row carries, so it type-checks across datasets. */
function lit<T extends { currency: unknown }>(header: string, value: string): CsvColumn<T> {
  return { header, key: "currency", formatter: () => value };
}

// --- invoices ------------------------------------------------------------

function xeroInvoiceColumns(opts: FormatOptions): CsvColumn<InvoiceExportRow>[] {
  return [
    { header: "ContactName", key: "customer_name" },
    { header: "EmailAddress", key: "customer_email" },
    { header: "POAddressLine1", key: "customer_address1" },
    { header: "POCity", key: "customer_city" },
    { header: "PORegion", key: "customer_region" },
    { header: "POPostalCode", key: "customer_postal_code" },
    { header: "POCountry", key: "customer_country" },
    { header: "InvoiceNumber", key: "invoice_number" },
    { header: "Reference", key: "notes" },
    { header: "InvoiceDate", key: "issue_date" },
    { header: "DueDate", key: "due_date" },
    { header: "Description", key: "item_description" },
    { header: "Quantity", key: "quantity", formatter: qty },
    { header: "UnitAmount", key: "unit_price", formatter: money },
    lit("AccountCode", opts.salesAccount),
    { header: "TaxType", key: "tax_rate", formatter: xeroTaxType("sales") },
    { header: "TaxAmount", key: "tax_amount", formatter: money },
    { header: "Currency", key: "currency" },
  ];
}

const qboInvoiceColumns: CsvColumn<InvoiceExportRow>[] = [
  { header: "InvoiceNo", key: "invoice_number" },
  { header: "Customer", key: "customer_name" },
  { header: "InvoiceDate", key: "issue_date" },
  { header: "DueDate", key: "due_date" },
  // Left blank: QuickBooks asks for a default Product/Service for blank rows on import.
  { header: "Item(Product/Service)", key: "item_description", formatter: () => "" },
  { header: "ItemDescription", key: "item_description" },
  { header: "ItemQuantity", key: "quantity", formatter: qty },
  { header: "ItemRate", key: "unit_price", formatter: money },
  { header: "ItemAmount", key: "line_total", formatter: money },
  { header: "Currency", key: "currency" },
  { header: "Taxable", key: "tax_rate", formatter: taxableYN },
  { header: "TaxRate", key: "tax_rate", formatter: qty },
];

export function getInvoiceLayout(
  format: ExportFormat,
  opts: FormatOptions,
): ExportLayout<InvoiceExportRow> {
  return format === "quickbooks"
    ? { columns: qboInvoiceColumns, filenameStem: "invoices-quickbooks" }
    : { columns: xeroInvoiceColumns(opts), filenameStem: "invoices-xero" };
}

// --- expenses (bills / purchases) ---------------------------------------

function xeroExpenseColumns(opts: FormatOptions): CsvColumn<ExpenseExportRow>[] {
  return [
    { header: "ContactName", key: "vendor" },
    { header: "InvoiceNumber", key: "reference" },
    { header: "InvoiceDate", key: "expense_date" },
    { header: "DueDate", key: "expense_date" },
    { header: "Description", key: "description", formatter: expenseDescription },
    lit("Quantity", "1"),
    { header: "UnitAmount", key: "amount", formatter: money },
    lit("AccountCode", opts.expenseAccount),
    { header: "TaxType", key: "tax_rate", formatter: xeroTaxType("purchases") },
    { header: "TaxAmount", key: "tax_amount", formatter: money },
    { header: "Currency", key: "currency" },
  ];
}

const qboExpenseColumns: CsvColumn<ExpenseExportRow>[] = [
  { header: "BillNo", key: "reference" },
  { header: "Supplier", key: "vendor" },
  { header: "BillDate", key: "expense_date" },
  { header: "DueDate", key: "expense_date" },
  {
    header: "Account",
    key: "category",
    formatter: (v) => (v ? String(v) : "Uncategorised Expense"),
  },
  { header: "LineDescription", key: "description", formatter: expenseDescription },
  { header: "LineAmount", key: "total", formatter: money },
  { header: "Currency", key: "currency" },
];

export function getExpenseLayout(
  format: ExportFormat,
  opts: FormatOptions,
): ExportLayout<ExpenseExportRow> {
  return format === "quickbooks"
    ? { columns: qboExpenseColumns, filenameStem: "expenses-quickbooks" }
    : { columns: xeroExpenseColumns(opts), filenameStem: "expenses-xero" };
}

// --- payments (bank statement / bank transactions) ----------------------

const xeroPaymentColumns: CsvColumn<PaymentExportRow>[] = [
  { header: "Date", key: "payment_date" },
  { header: "Amount", key: "amount", formatter: money },
  { header: "Payee", key: "customer_name" },
  { header: "Description", key: "invoice_number", formatter: (v) => `Invoice ${v ?? ""}`.trim() },
  {
    header: "Reference",
    key: "reference",
    formatter: (v, row) => (v ? String(v) : row.invoice_number),
  },
];

const qboPaymentColumns: CsvColumn<PaymentExportRow>[] = [
  { header: "Date", key: "payment_date" },
  {
    header: "Description",
    key: "invoice_number",
    formatter: (_v, row) => {
      const ref = row.reference ? ` (${row.reference})` : "";
      return `${row.customer_name ?? "Customer"} - Invoice ${row.invoice_number}${ref}`;
    },
  },
  { header: "Amount", key: "amount", formatter: money },
];

export function getPaymentLayout(format: ExportFormat): ExportLayout<PaymentExportRow> {
  return format === "quickbooks"
    ? { columns: qboPaymentColumns, filenameStem: "payments-quickbooks" }
    : { columns: xeroPaymentColumns, filenameStem: "payments-xero" };
}
