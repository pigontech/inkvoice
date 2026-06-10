import crypto from "node:crypto";
import { getDb } from "../database/connection";

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  payment_date: string;
  method: string;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function recalculateInvoicePayments(invoiceId: string): void {
  const db = getDb();
  const row = db
    .query("SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE invoice_id = ?")
    .get(invoiceId) as { total_paid: number };

  const invoice = db.query("SELECT total, status FROM invoices WHERE id = ?").get(invoiceId) as {
    total: number;
    status: string;
  } | null;
  if (!invoice) return;

  const amountPaid = round2(row.total_paid);
  let newStatus = invoice.status;

  // Only auto-update status for non-draft, non-voided, non-complete invoices
  if (!["draft", "voided", "complete"].includes(invoice.status)) {
    if (amountPaid >= invoice.total) {
      newStatus = "paid";
    } else if (amountPaid > 0) {
      newStatus = "partially_paid";
    } else {
      // Revert to sent (or keep overdue if past due)
      newStatus = invoice.status === "overdue" ? "overdue" : "sent";
    }
  }

  db.run(
    "UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
    [amountPaid, newStatus, invoiceId],
  );
}

export function recordPayment(
  invoiceId: string,
  data: {
    amount: number;
    payment_date: string;
    method?: string;
    reference?: string;
    notes?: string;
  },
): { success: true; data: Payment } | { success: false; error: string } {
  const db = getDb();

  const invoice = db
    .query(
      "SELECT id, status, total, amount_paid FROM invoices WHERE id = ? AND deleted_at IS NULL",
    )
    .get(invoiceId) as { id: string; status: string; total: number; amount_paid: number } | null;

  if (!invoice) return { success: false, error: "Invoice not found" };
  if (["draft", "voided", "complete"].includes(invoice.status)) {
    return {
      success: false,
      error: "Cannot record payment for draft, voided, or complete invoices",
    };
  }
  if (data.amount <= 0) return { success: false, error: "Payment amount must be greater than 0" };

  const id = crypto.randomBytes(16).toString("hex");
  db.run(
    `INSERT INTO payments (id, invoice_id, amount, payment_date, method, reference, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      invoiceId,
      data.amount,
      data.payment_date,
      data.method || "bank_transfer",
      data.reference || null,
      data.notes || null,
    ],
  );

  recalculateInvoicePayments(invoiceId);

  const payment = db.query("SELECT * FROM payments WHERE id = ?").get(id) as Payment;
  return { success: true, data: payment };
}

export function listPayments(invoiceId: string): Payment[] {
  const db = getDb();
  return db
    .query(
      "SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC, created_at DESC",
    )
    .all(invoiceId) as Payment[];
}

export function deletePayment(
  paymentId: string,
): { success: true; invoiceId: string } | { success: false; error: string } {
  const db = getDb();
  const payment = db.query("SELECT * FROM payments WHERE id = ?").get(paymentId) as Payment | null;
  if (!payment) return { success: false, error: "Payment not found" };

  db.run("DELETE FROM payments WHERE id = ?", [paymentId]);
  recalculateInvoicePayments(payment.invoice_id);

  return { success: true, invoiceId: payment.invoice_id };
}
