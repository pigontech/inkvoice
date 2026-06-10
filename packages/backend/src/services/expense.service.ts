import crypto from "node:crypto";
import { getDb } from "../database/connection";
import type { PaginatedResponse } from "../types/common";
import type { Expense } from "../types/expense";
import { todayIso } from "../utils/date";
import { getBaseCurrency } from "./exchange-rate.service";
import { createInvoice } from "./invoice.service";

/** Force rate to 1 when the expense is already in the base currency. */
function resolveExchangeRate(currency: string | undefined, provided: number | undefined): number {
  const cur = (currency || "USD").toUpperCase();
  if (cur === getBaseCurrency().toUpperCase()) return 1;
  return provided && provided > 0 ? provided : 1;
}

interface ExpenseListParams {
  category?: string;
  billable?: string;
  customer_id?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
  page: number;
  limit: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Resolve tax rate from a tax definition (if any) and derive tax_amount + total. */
function deriveTotals(
  amount: number,
  taxId: string | null,
): {
  tax_id: string | null;
  tax_rate: number;
  tax_amount: number;
  total: number;
} {
  const db = getDb();
  let taxRate = 0;
  let resolvedTaxId: string | null = null;
  if (taxId) {
    const taxDef = db.query("SELECT rate FROM tax_definitions WHERE id = ?").get(taxId) as {
      rate: number;
    } | null;
    if (taxDef) {
      taxRate = taxDef.rate;
      resolvedTaxId = taxId;
    }
  }
  const taxAmount = round2((amount * taxRate) / 100);
  return {
    tax_id: resolvedTaxId,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    total: round2(amount + taxAmount),
  };
}

function buildFilters(params: Partial<ExpenseListParams>): {
  where: string;
  queryParams: (string | number)[];
} {
  const conditions: string[] = [];
  const queryParams: (string | number)[] = [];

  if (params.category) {
    conditions.push("e.category = ?");
    queryParams.push(params.category);
  }
  if (params.billable !== undefined) {
    conditions.push("e.is_billable = ?");
    queryParams.push(params.billable === "true" ? 1 : 0);
  }
  if (params.customer_id) {
    conditions.push("e.customer_id = ?");
    queryParams.push(params.customer_id);
  }
  if (params.date_from) {
    conditions.push("e.expense_date >= ?");
    queryParams.push(params.date_from);
  }
  if (params.date_to) {
    conditions.push("e.expense_date <= ?");
    queryParams.push(params.date_to);
  }
  if (params.search) {
    conditions.push("(e.vendor LIKE ? OR e.description LIKE ? OR e.category LIKE ?)");
    queryParams.push(`%${params.search}%`, `%${params.search}%`, `%${params.search}%`);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    queryParams,
  };
}

export interface ExpenseRow extends Expense {
  customer_name: string | null;
  tax_name: string | null;
}

export function listExpenses(params: ExpenseListParams): PaginatedResponse<ExpenseRow> {
  const db = getDb();
  const { page, limit } = params;
  const offset = (page - 1) * limit;
  const { where, queryParams } = buildFilters(params);

  const countRow = db
    .query(`SELECT COUNT(*) as count FROM expenses e ${where}`)
    .get(...queryParams) as { count: number };

  const items = db
    .query(
      `SELECT e.*, c.name as customer_name, t.name as tax_name
       FROM expenses e
       LEFT JOIN customers c ON e.customer_id = c.id
       LEFT JOIN tax_definitions t ON e.tax_id = t.id
       ${where}
       ORDER BY e.expense_date DESC, e.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...queryParams, limit, offset) as ExpenseRow[];

  return {
    items,
    total: countRow.count,
    page,
    limit,
    totalPages: Math.ceil(countRow.count / limit),
  };
}

export function listExpensesForExport(params: Partial<ExpenseListParams>): ExpenseRow[] {
  const db = getDb();
  const { where, queryParams } = buildFilters(params);
  return db
    .query(
      `SELECT e.*, c.name as customer_name, t.name as tax_name
       FROM expenses e
       LEFT JOIN customers c ON e.customer_id = c.id
       LEFT JOIN tax_definitions t ON e.tax_id = t.id
       ${where}
       ORDER BY e.expense_date DESC, e.created_at DESC`,
    )
    .all(...queryParams) as ExpenseRow[];
}

export function getExpense(id: string): ExpenseRow | null {
  const db = getDb();
  return db
    .query(
      `SELECT e.*, c.name as customer_name, t.name as tax_name
       FROM expenses e
       LEFT JOIN customers c ON e.customer_id = c.id
       LEFT JOIN tax_definitions t ON e.tax_id = t.id
       WHERE e.id = ?`,
    )
    .get(id) as ExpenseRow | null;
}

export function createExpense(data: Partial<Expense>): Expense {
  const db = getDb();
  const id = crypto.randomBytes(16).toString("hex");
  const amount = data.amount ?? 0;
  const { tax_id, tax_rate, tax_amount, total } = deriveTotals(amount, data.tax_id || null);

  db.run(
    `INSERT INTO expenses (id, vendor, category, description, expense_date, amount, tax_id,
       tax_rate, tax_amount, total, currency, exchange_rate, receipt_reference, customer_id, is_billable, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.vendor || null,
      data.category || null,
      data.description || null,
      data.expense_date || todayIso(),
      amount,
      tax_id,
      tax_rate,
      tax_amount,
      total,
      data.currency || "USD",
      resolveExchangeRate(data.currency, data.exchange_rate),
      data.receipt_reference || null,
      data.customer_id || null,
      data.is_billable ?? 0,
      data.notes || null,
    ],
  );

  return db.query("SELECT * FROM expenses WHERE id = ?").get(id) as Expense;
}

export function updateExpense(id: string, data: Partial<Expense>): Expense | null {
  const db = getDb();
  const existing = db.query("SELECT id FROM expenses WHERE id = ?").get(id);
  if (!existing) return null;

  const amount = data.amount ?? 0;
  const { tax_id, tax_rate, tax_amount, total } = deriveTotals(amount, data.tax_id || null);

  db.run(
    `UPDATE expenses SET vendor = ?, category = ?, description = ?, expense_date = ?, amount = ?,
       tax_id = ?, tax_rate = ?, tax_amount = ?, total = ?, currency = ?, exchange_rate = ?, receipt_reference = ?,
       customer_id = ?, is_billable = ?, notes = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      data.vendor || null,
      data.category || null,
      data.description || null,
      data.expense_date || todayIso(),
      amount,
      tax_id,
      tax_rate,
      tax_amount,
      total,
      data.currency || "USD",
      resolveExchangeRate(data.currency, data.exchange_rate),
      data.receipt_reference || null,
      data.customer_id || null,
      data.is_billable ?? 0,
      data.notes || null,
      id,
    ],
  );

  return db.query("SELECT * FROM expenses WHERE id = ?").get(id) as Expense;
}

export function deleteExpense(id: string): { success: boolean; error?: string } {
  const db = getDb();
  const existing = db.query("SELECT id FROM expenses WHERE id = ?").get(id);
  if (!existing) return { success: false, error: "Expense not found" };
  db.run("DELETE FROM expenses WHERE id = ?", [id]);
  return { success: true };
}

/**
 * Re-bill a billable expense to its linked customer by creating a draft invoice
 * with a single line item derived from the expense. The expense is then stamped
 * with the new invoice's id so it can't be billed twice.
 */
export function rebillExpense(id: string): {
  success: boolean;
  error?: string;
  invoice_id?: string;
} {
  const db = getDb();
  const expense = db.query("SELECT * FROM expenses WHERE id = ?").get(id) as Expense | null;
  if (!expense) return { success: false, error: "Expense not found" };
  if (!expense.is_billable) return { success: false, error: "Expense is not billable" };
  if (!expense.customer_id) return { success: false, error: "Expense has no linked customer" };
  if (expense.billed_invoice_id) return { success: false, error: "Expense already re-billed" };

  const descriptionParts = [expense.vendor, expense.description || expense.category].filter(
    Boolean,
  );
  const description = descriptionParts.join(" — ") || "Expense";

  const invoice = createInvoice({
    customer_id: expense.customer_id,
    issue_date: todayIso(),
    currency: expense.currency,
    items: [
      {
        description,
        quantity: 1,
        unit_price: expense.amount,
        tax_id: expense.tax_id,
      },
    ],
  });

  db.run("UPDATE expenses SET billed_invoice_id = ?, updated_at = datetime('now') WHERE id = ?", [
    invoice.id,
    id,
  ]);

  return { success: true, invoice_id: invoice.id };
}
