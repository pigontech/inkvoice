import { getDb } from "../database/connection";
import { todayIso } from "../utils/date";
import { getBaseCurrency } from "./exchange-rate.service";

interface DateRangeParams {
  date_from?: string;
  date_to?: string;
}

export function getTaxSummary(params: DateRangeParams) {
  const db = getDb();
  const conditions = [
    "i.status IN ('sent', 'paid', 'partially_paid', 'overdue', 'complete')",
    "i.deleted_at IS NULL",
  ];
  const queryParams: string[] = [];

  if (params.date_from) {
    conditions.push("i.issue_date >= ?");
    queryParams.push(params.date_from);
  }
  if (params.date_to) {
    conditions.push("i.issue_date <= ?");
    queryParams.push(params.date_to);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const rows = db
    .query(
      `SELECT
        COALESCE(t.name, 'No Tax') as tax_name,
        ii.tax_rate,
        SUM(ii.line_total) as taxable_amount,
        SUM(ii.tax_amount) as tax_collected
       FROM invoice_items ii
       JOIN invoices i ON ii.invoice_id = i.id
       LEFT JOIN tax_definitions t ON ii.tax_id = t.id
       ${where}
       GROUP BY ii.tax_rate, t.name
       ORDER BY ii.tax_rate`,
    )
    .all(...queryParams) as {
    tax_name: string;
    tax_rate: number;
    taxable_amount: number;
    tax_collected: number;
  }[];

  const totals = rows.reduce(
    (acc, r) => ({
      taxable_amount: acc.taxable_amount + r.taxable_amount,
      tax_collected: acc.tax_collected + r.tax_collected,
    }),
    { taxable_amount: 0, tax_collected: 0 },
  );

  return { rows, totals };
}

export function getAgingReport() {
  const db = getDb();
  const today = todayIso();

  const invoices = db
    .query(
      `SELECT i.id, i.invoice_number, i.due_date, i.total, i.amount_paid, i.currency,
              c.name as customer_name
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       WHERE i.status IN ('sent', 'partially_paid', 'overdue')
         AND i.deleted_at IS NULL
         AND (i.type = 'invoice' OR i.type IS NULL)
       ORDER BY i.due_date ASC`,
    )
    .all() as {
    id: string;
    invoice_number: string;
    due_date: string | null;
    total: number;
    amount_paid: number;
    currency: string;
    customer_name: string;
  }[];

  type Bucket = { label: string; invoices: typeof invoices; count: number; total: number };
  const buckets: Record<string, Bucket> = {
    current: { label: "Current (Not Yet Due)", invoices: [], count: 0, total: 0 },
    "1-30": { label: "1-30 Days", invoices: [], count: 0, total: 0 },
    "31-60": { label: "31-60 Days", invoices: [], count: 0, total: 0 },
    "61-90": { label: "61-90 Days", invoices: [], count: 0, total: 0 },
    "90+": { label: "90+ Days", invoices: [], count: 0, total: 0 },
  };

  for (const inv of invoices) {
    const balance = inv.total - (inv.amount_paid || 0);
    if (balance <= 0) continue;

    const dueDate = inv.due_date || today;
    const diffMs = new Date(today).getTime() - new Date(dueDate).getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    let key: string;
    if (days <= 0) key = "current";
    else if (days <= 30) key = "1-30";
    else if (days <= 60) key = "31-60";
    else if (days <= 90) key = "61-90";
    else key = "90+";

    buckets[key].invoices.push(inv);
    buckets[key].count++;
    buckets[key].total += balance;
  }

  return Object.values(buckets);
}

export function getRevenueByCustomer(params: DateRangeParams) {
  const db = getDb();
  const conditions = [
    "i.status IN ('paid', 'partially_paid')",
    "i.deleted_at IS NULL",
    "(i.type = 'invoice' OR i.type IS NULL)",
  ];
  const queryParams: string[] = [];

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
      `SELECT c.name as customer_name, COUNT(*) as invoice_count,
              SUM(i.amount_paid * COALESCE(i.exchange_rate, 1)) as total_revenue,
              ROUND(SUM(i.amount_paid * COALESCE(i.exchange_rate, 1)) * 1.0 / COUNT(*), 2) as average_invoice
       FROM invoices i
       JOIN customers c ON i.customer_id = c.id
       ${where}
       GROUP BY i.customer_id
       ORDER BY total_revenue DESC`,
    )
    .all(...queryParams) as {
    customer_name: string;
    invoice_count: number;
    total_revenue: number;
    average_invoice: number;
  }[];
}

export interface ProductRevenueRow {
  product_name: string;
  quantity_sold: number;
  total_revenue: number;
  average_price: number;
  monthly_quantities: number[];
}

export function getRevenueByProduct(params: DateRangeParams): {
  months: string[];
  rows: ProductRevenueRow[];
} {
  const db = getDb();
  const conditions = ["i.status IN ('paid', 'partially_paid')", "i.deleted_at IS NULL"];
  const queryParams: string[] = [];

  if (params.date_from) {
    conditions.push("i.issue_date >= ?");
    queryParams.push(params.date_from);
  }
  if (params.date_to) {
    conditions.push("i.issue_date <= ?");
    queryParams.push(params.date_to);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const aggregates = db
    .query(
      `SELECT COALESCE(p.name, ii.description) as product_name,
              SUM(ii.quantity) as quantity_sold,
              SUM(ii.line_total * COALESCE(i.exchange_rate, 1)) as total_revenue,
              ROUND(SUM(ii.line_total * COALESCE(i.exchange_rate, 1)) * 1.0 / SUM(ii.quantity), 2) as average_price
       FROM invoice_items ii
       JOIN invoices i ON ii.invoice_id = i.id
       LEFT JOIN products p ON ii.product_id = p.id
       ${where}
       GROUP BY COALESCE(p.name, ii.description)
       ORDER BY total_revenue DESC`,
    )
    .all(...queryParams) as Omit<ProductRevenueRow, "monthly_quantities">[];

  // Build month bucket labels covering the requested range. If range is open-ended,
  // anchor on the actual data so callers don't get a misleading empty axis.
  const monthly = db
    .query(
      `SELECT COALESCE(p.name, ii.description) as product_name,
              strftime('%Y-%m', i.issue_date) as month,
              SUM(ii.quantity) as quantity
       FROM invoice_items ii
       JOIN invoices i ON ii.invoice_id = i.id
       LEFT JOIN products p ON ii.product_id = p.id
       ${where}
       GROUP BY product_name, month`,
    )
    .all(...queryParams) as { product_name: string; month: string; quantity: number }[];

  const monthBoundsFrom = params.date_from
    ? new Date(`${params.date_from}T00:00:00`)
    : monthly.length > 0
      ? new Date(`${monthly.reduce((a, b) => (a.month < b.month ? a : b)).month}-01T00:00:00`)
      : null;
  const monthBoundsTo = params.date_to ? new Date(`${params.date_to}T00:00:00`) : new Date();

  const months: string[] = [];
  if (monthBoundsFrom) {
    let cursor = new Date(monthBoundsFrom.getFullYear(), monthBoundsFrom.getMonth(), 1);
    const end = new Date(monthBoundsTo.getFullYear(), monthBoundsTo.getMonth(), 1);
    let safety = 0;
    while (cursor <= end && safety < 60) {
      months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      safety++;
    }
  }

  const byProductMonth = new Map<string, Map<string, number>>();
  for (const m of monthly) {
    if (!byProductMonth.has(m.product_name)) byProductMonth.set(m.product_name, new Map());
    byProductMonth.get(m.product_name)!.set(m.month, m.quantity);
  }

  const rows: ProductRevenueRow[] = aggregates.map((agg) => ({
    ...agg,
    monthly_quantities: months.map((m) => byProductMonth.get(agg.product_name)?.get(m) ?? 0),
  }));

  return { months, rows };
}

export interface ExpensesByCategoryRow {
  category: string;
  count: number;
  total: number;
}

export function getExpensesByCategory(params: DateRangeParams): {
  rows: ExpensesByCategoryRow[];
  total: number;
} {
  const db = getDb();
  const conditions: string[] = [];
  const queryParams: string[] = [];

  if (params.date_from) {
    conditions.push("expense_date >= ?");
    queryParams.push(params.date_from);
  }
  if (params.date_to) {
    conditions.push("expense_date <= ?");
    queryParams.push(params.date_to);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db
    .query(
      `SELECT COALESCE(NULLIF(category, ''), 'Uncategorized') as category,
              COUNT(*) as count, COALESCE(SUM(total), 0) as total
       FROM expenses ${where}
       GROUP BY COALESCE(NULLIF(category, ''), 'Uncategorized')
       ORDER BY total DESC`,
    )
    .all(...queryParams) as ExpensesByCategoryRow[];

  const total = rows.reduce((sum, r) => sum + r.total, 0);
  return { rows, total };
}

export interface ProfitLossMonthRow {
  month: string;
  revenue: number;
  expenses: number;
  net: number;
}

export function getProfitAndLoss(params: DateRangeParams): {
  base_currency: string;
  revenue: number;
  expenses: number;
  net: number;
  months: ProfitLossMonthRow[];
} {
  const db = getDb();

  // Revenue: paid invoices (exclude credit notes via type filter) in range.
  const revConditions = ["status IN ('paid', 'complete')", "deleted_at IS NULL"];
  const revParams: string[] = [];
  if (params.date_from) {
    revConditions.push("issue_date >= ?");
    revParams.push(params.date_from);
  }
  if (params.date_to) {
    revConditions.push("issue_date <= ?");
    revParams.push(params.date_to);
  }
  const revWhere = `WHERE ${revConditions.join(" AND ")}`;
  const revByMonth = db
    .query(
      `SELECT strftime('%Y-%m', issue_date) as month, COALESCE(SUM(total * COALESCE(exchange_rate, 1)), 0) as value
       FROM invoices ${revWhere} GROUP BY month`,
    )
    .all(...revParams) as { month: string; value: number }[];

  const expConditions: string[] = [];
  const expParams: string[] = [];
  if (params.date_from) {
    expConditions.push("expense_date >= ?");
    expParams.push(params.date_from);
  }
  if (params.date_to) {
    expConditions.push("expense_date <= ?");
    expParams.push(params.date_to);
  }
  const expWhere = expConditions.length ? `WHERE ${expConditions.join(" AND ")}` : "";
  const expByMonth = db
    .query(
      `SELECT strftime('%Y-%m', expense_date) as month, COALESCE(SUM(total * COALESCE(exchange_rate, 1)), 0) as value
       FROM expenses ${expWhere} GROUP BY month`,
    )
    .all(...expParams) as { month: string; value: number }[];

  const revMap = new Map(revByMonth.map((r) => [r.month, r.value]));
  const expMap = new Map(expByMonth.map((r) => [r.month, r.value]));
  const allMonths = Array.from(new Set([...revMap.keys(), ...expMap.keys()])).sort();

  const months: ProfitLossMonthRow[] = allMonths.map((month) => {
    const revenue = revMap.get(month) ?? 0;
    const expenses = expMap.get(month) ?? 0;
    return { month, revenue, expenses, net: revenue - expenses };
  });

  const revenue = months.reduce((sum, m) => sum + m.revenue, 0);
  const expenses = months.reduce((sum, m) => sum + m.expenses, 0);
  return { base_currency: getBaseCurrency(), revenue, expenses, net: revenue - expenses, months };
}

export interface CurrencyBreakdownRow {
  currency: string;
  invoice_count: number;
  native_total: number;
  base_total: number;
  /** Effective blended rate (base_total / native_total); 1 for the base currency. */
  exchange_rate: number;
}

/**
 * Exposure across currencies: issued (non-draft, non-voided) invoices grouped
 * by their own currency, with both the native total and its base-currency
 * equivalent so a mixed-currency user can see the split behind a consolidated
 * total.
 */
export function getCurrencyBreakdown(params: DateRangeParams): {
  base_currency: string;
  rows: CurrencyBreakdownRow[];
  base_total: number;
} {
  const db = getDb();
  const conditions = [
    "status NOT IN ('draft', 'voided')",
    "deleted_at IS NULL",
    "(type = 'invoice' OR type IS NULL)",
  ];
  const queryParams: string[] = [];
  if (params.date_from) {
    conditions.push("issue_date >= ?");
    queryParams.push(params.date_from);
  }
  if (params.date_to) {
    conditions.push("issue_date <= ?");
    queryParams.push(params.date_to);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const raw = db
    .query(
      `SELECT COALESCE(currency, 'USD') as currency,
              COUNT(*) as invoice_count,
              COALESCE(SUM(total), 0) as native_total,
              COALESCE(SUM(total * COALESCE(exchange_rate, 1)), 0) as base_total
       FROM invoices ${where}
       GROUP BY COALESCE(currency, 'USD')
       ORDER BY base_total DESC`,
    )
    .all(...queryParams) as Omit<CurrencyBreakdownRow, "exchange_rate">[];

  const rows: CurrencyBreakdownRow[] = raw.map((r) => ({
    ...r,
    exchange_rate: r.native_total ? Math.round((r.base_total / r.native_total) * 1e6) / 1e6 : 1,
  }));
  const base_total = rows.reduce((sum, r) => sum + r.base_total, 0);
  return { base_currency: getBaseCurrency(), rows, base_total };
}

export interface CashFlowForecastRow {
  month: string;
  expected_invoiced: number;
  expected_recurring: number;
  total: number;
}

export function getCashFlowForecast(monthsAhead = 6): CashFlowForecastRow[] {
  const db = getDb();
  const today = new Date();
  const months: string[] = [];
  for (let i = 0; i < monthsAhead; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  // Outstanding invoices grouped by due_date month — only counts toward
  // forecast for months that still lie within the horizon.
  const outstandingRows = db
    .query(
      `SELECT strftime('%Y-%m', due_date) as month,
              COALESCE(SUM((total - COALESCE(amount_paid, 0)) * COALESCE(exchange_rate, 1)), 0) as expected
       FROM invoices
       WHERE status IN ('sent', 'overdue', 'partially_paid')
         AND deleted_at IS NULL
         AND (type = 'invoice' OR type IS NULL)
         AND due_date IS NOT NULL
       GROUP BY month`,
    )
    .all() as { month: string; expected: number }[];
  const outstandingByMonth = new Map(outstandingRows.map((r) => [r.month, r.expected]));

  // Active recurring invoices: project occurrences within the horizon and
  // bucket the template invoice's total under the month each instance is due.
  const recurringRows = db
    .query(
      `SELECT r.frequency, r.interval_value, r.next_run_date, r.end_date,
              COALESCE(t.total * COALESCE(t.exchange_rate, 1), 0) as template_total
       FROM recurring_invoices r
       LEFT JOIN invoices t ON r.template_invoice_id = t.id
       WHERE r.status = 'active'`,
    )
    .all() as {
    frequency: string;
    interval_value: number;
    next_run_date: string;
    end_date: string | null;
    template_total: number;
  }[];

  const horizonEnd = new Date(today.getFullYear(), today.getMonth() + monthsAhead, 0);
  const recurringByMonth = new Map<string, number>();
  const monthSet = new Set(months);
  for (const r of recurringRows) {
    const cursor = new Date(`${r.next_run_date}T00:00:00`);
    const end = r.end_date ? new Date(`${r.end_date}T00:00:00`) : null;
    let safety = 0;
    while (cursor <= horizonEnd && (!end || cursor <= end) && safety < 365) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      if (monthSet.has(key)) {
        recurringByMonth.set(key, (recurringByMonth.get(key) ?? 0) + r.template_total);
      }
      switch (r.frequency) {
        case "daily":
          cursor.setDate(cursor.getDate() + r.interval_value);
          break;
        case "weekly":
          cursor.setDate(cursor.getDate() + 7 * r.interval_value);
          break;
        case "monthly":
          cursor.setMonth(cursor.getMonth() + r.interval_value);
          break;
        case "yearly":
          cursor.setFullYear(cursor.getFullYear() + r.interval_value);
          break;
        default:
          // Unknown frequency: skip rather than loop.
          safety = 365;
      }
      safety++;
    }
  }

  return months.map((m) => {
    const expected_invoiced = outstandingByMonth.get(m) ?? 0;
    const expected_recurring = recurringByMonth.get(m) ?? 0;
    return {
      month: m,
      expected_invoiced,
      expected_recurring,
      total: expected_invoiced + expected_recurring,
    };
  });
}
