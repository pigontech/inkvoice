import crypto from "node:crypto";
import { getDb } from "../database/connection";
import { todayIso, toIsoDate } from "../utils/date";
import { createInvoice, getInvoice } from "./invoice.service";

export interface RecurringInvoice {
  id: string;
  customer_id: string;
  template_invoice_id: string;
  frequency: string;
  interval_value: number;
  next_run_date: string;
  end_date: string | null;
  status: string;
  auto_send: number;
  total_generated: number;
  last_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateRecurringData {
  customer_id: string;
  template_invoice_id: string;
  frequency: string;
  interval_value?: number;
  next_run_date: string;
  end_date?: string | null;
  auto_send?: boolean;
}

export function listRecurring(params?: {
  status?: string;
}): (RecurringInvoice & { customer_name: string })[] {
  const db = getDb();
  const conditions: string[] = [];
  const queryParams: string[] = [];

  if (params?.status) {
    conditions.push("r.status = ?");
    queryParams.push(params.status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return db
    .query(
      `SELECT r.*, c.name as customer_name FROM recurring_invoices r
       LEFT JOIN customers c ON r.customer_id = c.id
       ${where} ORDER BY r.next_run_date ASC`,
    )
    .all(...queryParams) as (RecurringInvoice & { customer_name: string })[];
}

export function getRecurring(id: string): (RecurringInvoice & { customer_name: string }) | null {
  const db = getDb();
  return db
    .query(
      `SELECT r.*, c.name as customer_name FROM recurring_invoices r
       LEFT JOIN customers c ON r.customer_id = c.id WHERE r.id = ?`,
    )
    .get(id) as (RecurringInvoice & { customer_name: string }) | null;
}

export function createRecurring(
  data: CreateRecurringData,
): RecurringInvoice & { customer_name: string } {
  const db = getDb();
  const id = crypto.randomBytes(16).toString("hex");

  db.run(
    `INSERT INTO recurring_invoices (id, customer_id, template_invoice_id, frequency, interval_value, next_run_date, end_date, auto_send)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.customer_id,
      data.template_invoice_id,
      data.frequency,
      data.interval_value || 1,
      data.next_run_date,
      data.end_date || null,
      data.auto_send ? 1 : 0,
    ],
  );

  return getRecurring(id)!;
}

export function updateRecurring(
  id: string,
  data: Partial<CreateRecurringData>,
): (RecurringInvoice & { customer_name: string }) | null {
  const existing = getRecurring(id);
  if (!existing) return null;

  const db = getDb();
  db.run(
    `UPDATE recurring_invoices SET
       frequency = COALESCE(?, frequency),
       interval_value = COALESCE(?, interval_value),
       next_run_date = COALESCE(?, next_run_date),
       end_date = COALESCE(?, end_date),
       auto_send = COALESCE(?, auto_send),
       updated_at = datetime('now')
     WHERE id = ?`,
    [
      data.frequency || null,
      data.interval_value || null,
      data.next_run_date || null,
      data.end_date !== undefined ? data.end_date || null : null,
      data.auto_send !== undefined ? (data.auto_send ? 1 : 0) : null,
      id,
    ],
  );

  return getRecurring(id);
}

export function pauseRecurring(id: string): boolean {
  const db = getDb();
  const result = db.run(
    "UPDATE recurring_invoices SET status = 'paused', updated_at = datetime('now') WHERE id = ? AND status = 'active'",
    [id],
  );
  return result.changes > 0;
}

export function resumeRecurring(id: string): boolean {
  const db = getDb();
  const existing = getRecurring(id);
  if (!existing || existing.status !== "paused") return false;

  // If next_run_date is in the past, advance to today
  const today = todayIso();
  const nextRun = existing.next_run_date < today ? today : existing.next_run_date;

  db.run(
    "UPDATE recurring_invoices SET status = 'active', next_run_date = ?, updated_at = datetime('now') WHERE id = ?",
    [nextRun, id],
  );
  return true;
}

export function cancelRecurring(id: string): boolean {
  const db = getDb();
  const result = db.run(
    "UPDATE recurring_invoices SET status = 'completed', updated_at = datetime('now') WHERE id = ? AND status IN ('active', 'paused')",
    [id],
  );
  return result.changes > 0;
}

export function deleteRecurring(id: string): { success: boolean; error?: string } {
  const db = getDb();
  const existing = getRecurring(id);
  if (!existing) return { success: false, error: "Not found" };
  if (existing.total_generated > 0) {
    // Cancel instead of delete
    cancelRecurring(id);
    return { success: true };
  }
  db.run("DELETE FROM recurring_invoices WHERE id = ?", [id]);
  return { success: true };
}

function advanceDate(dateStr: string, frequency: string, interval: number): string {
  const d = new Date(dateStr);
  switch (frequency) {
    case "daily":
      d.setDate(d.getDate() + interval);
      break;
    case "weekly":
      d.setDate(d.getDate() + 7 * interval);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + interval);
      break;
    case "yearly":
      d.setFullYear(d.getFullYear() + interval);
      break;
  }
  return toIsoDate(d);
}

/**
 * Optional plan-limit hook registered by a downstream overlay. When set, the
 * scheduler calls it before generating a recurring invoice so a free tenant
 * with `max_invoices` already at cap cannot blow past the limit via cron.
 * Returning `{allowed: false}` skips generation for this tick without
 * advancing `next_run_date` — the cycle retries on the next scheduler tick.
 * In self-hosted mode the hook is never registered and the check is a no-op.
 */
export type RecurringLimitChecker = () => { allowed: boolean; reason?: string };
let recurringLimitChecker: RecurringLimitChecker | null = null;
export function setRecurringLimitChecker(check: RecurringLimitChecker | null): void {
  recurringLimitChecker = check;
}

export function generateInvoice(recurringId: string): string | null {
  const recurring = getRecurring(recurringId);
  if (!recurring || recurring.status !== "active") return null;

  const template = getInvoice(recurring.template_invoice_id);
  if (!template) return null;

  // Plan-limit check (registered by an overlay at boot). On block, leave
  // next_run_date untouched so we retry next cycle if the cap clears.
  if (recurringLimitChecker) {
    const result = recurringLimitChecker();
    if (!result.allowed) {
      return null;
    }
  }

  const today = todayIso();

  const newInvoice = createInvoice({
    customer_id: recurring.customer_id,
    issue_date: today,
    due_date: template.due_date
      ? advanceDate(today, "daily", dateDiffDays(template.issue_date, template.due_date))
      : null,
    notes: template.notes,
    payment_terms: template.payment_terms,
    currency: template.currency,
    discount_type: template.discount_type,
    discount_value: template.discount_value,
    template_id: template.template_id,
    items: template.items.map((item) => ({
      product_id: item.product_id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      unit: item.unit,
      tax_id: item.tax_id,
      tax_rate: item.tax_rate,
      sort_order: item.sort_order,
    })),
  });

  const db = getDb();
  const nextRunDate = advanceDate(
    recurring.next_run_date,
    recurring.frequency,
    recurring.interval_value,
  );

  // Check if completed
  const newStatus = recurring.end_date && nextRunDate > recurring.end_date ? "completed" : "active";

  db.run(
    `UPDATE recurring_invoices SET
       total_generated = total_generated + 1,
       last_generated_at = datetime('now'),
       next_run_date = ?,
       status = ?,
       updated_at = datetime('now')
     WHERE id = ?`,
    [nextRunDate, newStatus, recurringId],
  );

  return newInvoice.id;
}

function dateDiffDays(from: string, to: string): number {
  const d1 = new Date(from);
  const d2 = new Date(to);
  return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
}

export function processAllDue(): { generated: number; errors: number } {
  const db = getDb();
  const today = todayIso();
  const due = db
    .query("SELECT id FROM recurring_invoices WHERE status = 'active' AND next_run_date <= ?")
    .all(today) as { id: string }[];

  let generated = 0;
  let errors = 0;

  for (const row of due) {
    try {
      const invoiceId = generateInvoice(row.id);
      if (invoiceId) generated++;
      else errors++;
    } catch {
      errors++;
    }
  }

  return { generated, errors };
}
