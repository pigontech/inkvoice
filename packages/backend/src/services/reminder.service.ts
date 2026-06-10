import crypto from "node:crypto";
import { getDb } from "../database/connection";
import { toIsoDate } from "../utils/date";
import { isEmailConfigured, sendEmail } from "./email.service";

export interface ReminderRule {
  id: string;
  name: string;
  days_offset: number;
  type: string;
  email_subject: string;
  email_body: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export function listRules(): ReminderRule[] {
  const db = getDb();
  return db.query("SELECT * FROM reminder_rules ORDER BY days_offset ASC").all() as ReminderRule[];
}

export function getRule(id: string): ReminderRule | null {
  const db = getDb();
  return db.query("SELECT * FROM reminder_rules WHERE id = ?").get(id) as ReminderRule | null;
}

export interface ReminderRuleInput {
  name: string;
  days_offset: number;
  type: string;
  email_subject: string;
  email_body: string;
  is_active?: boolean;
}

export function createRule(data: ReminderRuleInput): ReminderRule {
  const db = getDb();
  const id = crypto.randomBytes(16).toString("hex");
  db.run(
    "INSERT INTO reminder_rules (id, name, days_offset, type, email_subject, email_body, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      data.name,
      data.days_offset,
      data.type,
      data.email_subject,
      data.email_body,
      data.is_active ? 1 : 0,
    ],
  );
  const created = getRule(id);
  if (!created) throw new Error("Failed to create reminder rule");
  return created;
}

export function updateRule(id: string, data: Partial<ReminderRuleInput>): ReminderRule | null {
  const existing = getRule(id);
  if (!existing) return null;
  const db = getDb();
  db.run(
    `UPDATE reminder_rules SET name = ?, days_offset = ?, type = ?, email_subject = ?, email_body = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`,
    [
      data.name ?? existing.name,
      data.days_offset ?? existing.days_offset,
      data.type ?? existing.type,
      data.email_subject ?? existing.email_subject,
      data.email_body ?? existing.email_body,
      data.is_active !== undefined ? (data.is_active ? 1 : 0) : existing.is_active,
      id,
    ],
  );
  return getRule(id);
}

export function deleteRule(id: string): boolean {
  const db = getDb();
  const result = db.run("DELETE FROM reminder_rules WHERE id = ?", [id]);
  return result.changes > 0;
}

export function getReminderLog(invoiceId: string) {
  const db = getDb();
  return db
    .query(
      `SELECT rl.*, rr.name as rule_name FROM reminder_log rl
       LEFT JOIN reminder_rules rr ON rl.rule_id = rr.id
       WHERE rl.invoice_id = ? ORDER BY rl.sent_at DESC`,
    )
    .all(invoiceId);
}

export async function processAllReminders(): Promise<{ sent: number; errors: number }> {
  if (!(await isEmailConfigured())) return { sent: 0, errors: 0 };

  const db = getDb();
  const rules = db
    .query("SELECT * FROM reminder_rules WHERE is_active = 1")
    .all() as ReminderRule[];
  if (rules.length === 0) return { sent: 0, errors: 0 };

  let sent = 0;
  let errors = 0;

  for (const rule of rules) {
    // Resolve which due_date the rule targets:
    //   before_due: today + days_offset  (e.g. fire 7 days before a due date)
    //   on_due:     today
    //   after_due:  today - days_offset  (e.g. fire 7 days after a due date)
    const targetDate = new Date();
    if (rule.type === "before_due") {
      targetDate.setDate(targetDate.getDate() + rule.days_offset);
    } else if (rule.type === "after_due") {
      targetDate.setDate(targetDate.getDate() - rule.days_offset);
    }
    const targetDateStr = toIsoDate(targetDate);

    // Find invoices that match this rule and haven't been reminded yet
    interface ReminderInvoiceRow {
      id: string;
      invoice_number: string;
      total: number;
      amount_paid: number | null;
      due_date: string | null;
      currency: string;
      customer_name: string | null;
      customer_email: string;
    }
    const invoices = db
      .query(
        `SELECT i.id, i.invoice_number, i.total, i.amount_paid, i.due_date, i.currency,
                c.name as customer_name, c.email as customer_email
         FROM invoices i
         LEFT JOIN customers c ON i.customer_id = c.id
         WHERE i.status IN ('sent', 'partially_paid', 'overdue')
           AND i.deleted_at IS NULL
           AND i.due_date = ?
           AND c.email IS NOT NULL
           AND i.id NOT IN (SELECT invoice_id FROM reminder_log WHERE rule_id = ?)`,
      )
      .all(targetDateStr, rule.id) as ReminderInvoiceRow[];

    for (const inv of invoices) {
      try {
        // Simple template variable replacement
        let subject = rule.email_subject;
        let body = rule.email_body;
        const vars: Record<string, string> = {
          "{{customer_name}}": inv.customer_name || "",
          "{{invoice_number}}": inv.invoice_number,
          "{{amount_due}}": String(inv.total - (inv.amount_paid || 0)),
          "{{due_date}}": inv.due_date || "",
          "{{total}}": String(inv.total),
        };
        for (const [key, val] of Object.entries(vars)) {
          subject = subject.replaceAll(key, val);
          body = body.replaceAll(key, val);
        }

        const result = await sendEmail({
          to: inv.customer_email,
          subject,
          html: `<p>${body.replace(/\n/g, "<br>")}</p>`,
          text: body,
        });

        const logId = crypto.randomBytes(16).toString("hex");
        db.run(
          "INSERT OR IGNORE INTO reminder_log (id, invoice_id, rule_id, status, error_message) VALUES (?, ?, ?, ?, ?)",
          [
            logId,
            inv.id,
            rule.id,
            result.success ? "sent" : "failed",
            result.success ? null : result.error,
          ],
        );

        if (result.success) sent++;
        else errors++;
      } catch {
        errors++;
      }
    }
  }

  return { sent, errors };
}
