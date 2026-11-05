import crypto from "node:crypto";
import { getDb } from "../database/connection";
import {
  type CashDiscountConfig,
  cashDiscountOn,
  hasCashDiscount,
  isWithinCashDiscountWindow,
} from "../utils/cash-discount";
import { outstandingBalance } from "../utils/currency";

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

  const invoice = db
    .query("SELECT total, status, currency, cash_discount_applied FROM invoices WHERE id = ?")
    .get(invoiceId) as {
    total: number;
    status: string;
    currency: string;
    cash_discount_applied: number;
  } | null;
  if (!invoice) return;

  const amountPaid = round2(row.total_paid);
  const discountApplied = round2(invoice.cash_discount_applied || 0);
  // Settled once received cash plus any early-payment discount reaches the total.
  const settled = amountPaid + discountApplied;
  let newStatus = invoice.status;

  // Only auto-update status for non-draft, non-voided, non-complete invoices
  if (!["draft", "voided", "complete"].includes(invoice.status)) {
    if (outstandingBalance(invoice.total, settled, invoice.currency) === 0) {
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
    apply_cash_discount?: boolean;
  },
): { success: true; data: Payment } | { success: false; error: string } {
  const db = getDb();

  const invoice = db
    .query(
      `SELECT id, status, total, amount_paid, issue_date, cash_discount_type,
              cash_discount_value, cash_discount_days, cash_discount_applied
       FROM invoices WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(invoiceId) as {
    id: string;
    status: string;
    total: number;
    amount_paid: number;
    issue_date: string;
    cash_discount_type: string | null;
    cash_discount_value: number;
    cash_discount_days: number;
    cash_discount_applied: number;
  } | null;

  if (!invoice) return { success: false, error: "Invoice not found" };
  if (["draft", "voided", "complete"].includes(invoice.status)) {
    return {
      success: false,
      error: "Cannot record payment for draft, voided, or complete invoices",
    };
  }
  if (data.amount <= 0) return { success: false, error: "Payment amount must be greater than 0" };

  let effectiveAmount = data.amount;

  // Early-payment (cash) discount: allow settling for less than the balance on
  // condition the payment arrives inside the discount window.
  if (data.apply_cash_discount) {
    const config: CashDiscountConfig = {
      type: invoice.cash_discount_type,
      value: invoice.cash_discount_value,
      days: invoice.cash_discount_days,
    };
    const balance = round2(invoice.total - invoice.amount_paid - invoice.cash_discount_applied);
    if (!hasCashDiscount(config)) {
      return { success: false, error: "This invoice has no early-payment discount" };
    }
    if (!isWithinCashDiscountWindow(invoice.issue_date, data.payment_date, config.days || 0)) {
      return { success: false, error: "Early-payment discount window has passed" };
    }
    if (invoice.status === "paid") {
      return { success: false, error: "Invoice is already paid" };
    }
    const discount = cashDiscountOn(balance, {
      type: config.type!,
      value: config.value!,
      days: config.days!,
    });
    if (Math.abs(round2(data.amount) - round2(balance - discount)) > 0.01) {
      return { success: false, error: "Payment amount must equal the discounted balance" };
    }
    effectiveAmount = round2(balance - discount);
    db.run(
      "UPDATE invoices SET cash_discount_applied = cash_discount_applied + ?, updated_at = datetime('now') WHERE id = ?",
      [discount, invoiceId],
    );
  }

  const id = crypto.randomBytes(16).toString("hex");
  db.run(
    `INSERT INTO payments (id, invoice_id, amount, payment_date, method, reference, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      invoiceId,
      effectiveAmount,
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
  // Relinquish any early-payment discount tied to the deleted payment; a fresh
  // payment can re-claim it if still inside the window.
  db.run("UPDATE invoices SET cash_discount_applied = 0 WHERE id = ?", [payment.invoice_id]);
  recalculateInvoicePayments(payment.invoice_id);

  return { success: true, invoiceId: payment.invoice_id };
}
