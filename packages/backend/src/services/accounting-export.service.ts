import { getDb } from "../database/connection";

/**
 * Accounting export — one-way CSV hand-off of invoices, payments and expenses
 * for import into QuickBooks Online or Xero. These builders return *normalized*
 * rows (native amounts, ISO dates); the column layout per target format lives in
 * `accounting-export.formats.ts`. Date filtering mirrors `report.service.ts`.
 */

export interface AccountingDateRange {
  date_from?: string;
  date_to?: string;
}

/** Invoice statuses considered finalized enough to book (drafts/voided excluded). */
const FINALIZED_STATUSES = ["sent", "paid", "partially_paid", "overdue", "complete"];

/** One row per invoice line item; invoice-header fields repeat per line. */
export interface InvoiceExportRow {
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  status: string;
  currency: string;
  exchange_rate: number;
  notes: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_address1: string | null;
  customer_city: string | null;
  customer_region: string | null;
  customer_postal_code: string | null;
  customer_country: string | null;
  item_description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  tax_name: string | null;
  tax_rate: number;
  tax_amount: number;
}

export function getInvoiceExportRows(params: AccountingDateRange): InvoiceExportRow[] {
  const db = getDb();
  const conditions = [
    `i.status IN (${FINALIZED_STATUSES.map(() => "?").join(", ")})`,
    "i.deleted_at IS NULL",
    "(i.type IS NULL OR i.type = 'invoice')",
  ];
  const queryParams: string[] = [...FINALIZED_STATUSES];
  if (params.date_from) {
    conditions.push("i.issue_date >= ?");
    queryParams.push(params.date_from);
  }
  if (params.date_to) {
    conditions.push("i.issue_date <= ?");
    queryParams.push(params.date_to);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;

  return db
    .query(
      `SELECT
        i.invoice_number,
        i.issue_date,
        i.due_date,
        i.status,
        i.currency,
        COALESCE(i.exchange_rate, 1) as exchange_rate,
        i.notes,
        c.name as customer_name,
        c.email as customer_email,
        c.address_line1 as customer_address1,
        c.city as customer_city,
        c.state as customer_region,
        c.postal_code as customer_postal_code,
        c.country as customer_country,
        ii.description as item_description,
        ii.quantity,
        ii.unit_price,
        ii.line_total,
        ii.tax_rate,
        ii.tax_amount,
        t.name as tax_name
       FROM invoice_items ii
       JOIN invoices i ON ii.invoice_id = i.id
       LEFT JOIN customers c ON i.customer_id = c.id
       LEFT JOIN tax_definitions t ON ii.tax_id = t.id
       ${where}
       ORDER BY i.issue_date, i.invoice_number, ii.sort_order, ii.created_at`,
    )
    .all(...queryParams) as InvoiceExportRow[];
}

/** One row per recorded payment (currency inherited from the invoice). */
export interface PaymentExportRow {
  payment_date: string;
  amount: number;
  customer_name: string | null;
  invoice_number: string;
  method: string;
  reference: string | null;
  notes: string | null;
  currency: string;
}

export function getPaymentExportRows(params: AccountingDateRange): PaymentExportRow[] {
  const db = getDb();
  const conditions = ["i.deleted_at IS NULL"];
  const queryParams: string[] = [];
  if (params.date_from) {
    conditions.push("p.payment_date >= ?");
    queryParams.push(params.date_from);
  }
  if (params.date_to) {
    conditions.push("p.payment_date <= ?");
    queryParams.push(params.date_to);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;

  return db
    .query(
      `SELECT
        p.payment_date,
        p.amount,
        p.method,
        p.reference,
        p.notes,
        i.invoice_number,
        i.currency,
        c.name as customer_name
       FROM payments p
       JOIN invoices i ON p.invoice_id = i.id
       LEFT JOIN customers c ON i.customer_id = c.id
       ${where}
       ORDER BY p.payment_date, i.invoice_number`,
    )
    .all(...queryParams) as PaymentExportRow[];
}

/** One row per expense (maps to a bill / purchase in QuickBooks / Xero). */
export interface ExpenseExportRow {
  expense_date: string;
  vendor: string | null;
  category: string | null;
  description: string | null;
  reference: string | null;
  amount: number;
  tax_name: string | null;
  tax_rate: number;
  tax_amount: number;
  total: number;
  currency: string;
  exchange_rate: number;
  customer_name: string | null;
  is_billable: number;
}

export function getExpenseExportRows(params: AccountingDateRange): ExpenseExportRow[] {
  const db = getDb();
  const conditions: string[] = [];
  const queryParams: string[] = [];
  if (params.date_from) {
    conditions.push("e.expense_date >= ?");
    queryParams.push(params.date_from);
  }
  if (params.date_to) {
    conditions.push("e.expense_date <= ?");
    queryParams.push(params.date_to);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return db
    .query(
      `SELECT
        e.expense_date,
        e.vendor,
        e.category,
        e.description,
        e.receipt_reference as reference,
        e.amount,
        e.tax_rate,
        e.tax_amount,
        e.total,
        e.currency,
        COALESCE(e.exchange_rate, 1) as exchange_rate,
        e.is_billable,
        t.name as tax_name,
        c.name as customer_name
       FROM expenses e
       LEFT JOIN customers c ON e.customer_id = c.id
       LEFT JOIN tax_definitions t ON e.tax_id = t.id
       ${where}
       ORDER BY e.expense_date`,
    )
    .all(...queryParams) as ExpenseExportRow[];
}
