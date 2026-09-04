import crypto from "node:crypto";
import { getDb } from "../database/connection";
import { todayIso } from "../utils/date";
import { logger } from "../utils/logger";
import { logActivity } from "./activity.service";
import { getDefaultMethod } from "./customer-payment-method.service";
import { getInvoice } from "./invoice.service";
import { sendInvoiceEmail } from "./invoice-send.service";
import { dispatchEvent } from "./outgoing-webhooks.service";
import { recordPayment } from "./payment.service";
import { getGateway } from "./payment-gateways/registry";
import type { OffSessionResult } from "./payment-gateways/types";
import { getAllSettings, getSetting } from "./settings.service";

/** Days after a soft decline to retry. Index is attemptNo - 1. */
export const RETRY_OFFSET_DAYS = [1, 3, 5] as const;
export const MAX_ATTEMPTS = RETRY_OFFSET_DAYS.length;

export type AutoBillOutcome = (OffSessionResult | { status: "skipped"; errorCode: string }) & {
  /**
   * True exactly when this call already emailed the customer a payment link
   * (the terminal-failure path). A caller that also sends its own invoice
   * email on a failed charge, such as generateInvoice's auto_send path, must
   * skip that email when this is true, so the customer is not emailed twice
   * for the same invoice.
   */
  emailedPaymentLink: boolean;
};

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/** True only for a SQLite UNIQUE index violation, never a foreign key or NOT NULL failure. */
function isUniqueConstraintViolation(err: unknown): boolean {
  return (err as { code?: string } | null | undefined)?.code === "SQLITE_CONSTRAINT_UNIQUE";
}

/** Has this exact gateway reference already been recorded as a payment on this invoice. */
function paymentAlreadyRecorded(invoiceId: string, reference: string): boolean {
  const row = getDb()
    .query("SELECT 1 FROM payments WHERE invoice_id = ? AND reference = ? LIMIT 1")
    .get(invoiceId, reference);
  return row !== null;
}

function writeAttempt(row: {
  invoiceId: string;
  recurringId?: string;
  paymentMethodId?: string;
  attemptNo: number;
  status: string;
  reference?: string;
  errorCode?: string;
  errorMessage?: string;
  nextRetryAt: string | null;
}): void {
  try {
    getDb().run(
      `INSERT INTO auto_bill_attempts
         (id, invoice_id, recurring_id, payment_method_id, attempt_no,
          status, gateway_reference, error_code, error_message, next_retry_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomBytes(16).toString("hex"),
        row.invoiceId,
        row.recurringId ?? null,
        row.paymentMethodId ?? null,
        row.attemptNo,
        row.status,
        row.reference ?? null,
        row.errorCode ?? null,
        row.errorMessage ?? null,
        row.nextRetryAt,
      ],
    );
  } catch (err) {
    // ux_aba_invoice_attempt rejected a duplicate (invoice_id, attempt_no).
    // That means a concurrent tick already logged this attempt: a no-op.
    if (!isUniqueConstraintViolation(err)) throw err;
  }
}

/**
 * Best-effort admin notification. Mirrors notifyInvoiceViewed exactly, except
 * the email wording branches on `kind`: a plain decline never touched the
 * customer's card (a payment link went out instead), while "capture_unrecorded"
 * means the card WAS charged and Inkvoice could not record it, which needs
 * manual reconciliation, and possibly a refund, not a payment link.
 */
async function notifyFailure(
  invoiceId: string,
  invoiceNumber: string,
  reason: string,
  kind: "declined" | "capture_unrecorded" = "declined",
): Promise<void> {
  try {
    logActivity({
      user_id: null,
      user_name: "System",
      action: "auto_bill_failed",
      resource_type: "invoice",
      resource_id: invoiceId,
      metadata: { invoice_number: invoiceNumber, reason, kind },
    });

    void dispatchEvent("invoice.auto_bill_failed", {
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      reason,
      kind,
    });

    if (getSetting("notify_on_auto_bill_failure") !== "true") return;

    const { isEmailConfigured, sendEmail } = await import("./email.service");
    if (!(await isEmailConfigured())) return;
    const settings = getAllSettings();
    const to = settings.company_email;
    if (!to) return;

    const subject =
      kind === "capture_unrecorded"
        ? `Auto-billing captured a payment that needs reconciliation, invoice ${invoiceNumber}`
        : `Auto-billing failed for invoice ${invoiceNumber}`;
    const text =
      kind === "capture_unrecorded"
        ? `The saved card for invoice ${invoiceNumber} was charged (${reason}), but Inkvoice could not record the payment. Reconcile it at the payment provider manually, a refund may be required.`
        : `The saved card for invoice ${invoiceNumber} could not be charged (${reason}). The customer has been emailed a payment link.`;
    const html =
      kind === "capture_unrecorded"
        ? `<p>The saved card for invoice <strong>${invoiceNumber}</strong> was charged (${reason}), but Inkvoice could not record the payment.</p><p>Reconcile it at the payment provider manually. A refund may be required.</p>`
        : `<p>The saved card for invoice <strong>${invoiceNumber}</strong> could not be charged (${reason}).</p><p>The customer has been emailed a payment link.</p>`;

    await sendEmail({ to, subject, text, html });
  } catch (err) {
    logger.warn({ err, invoiceId }, "Auto-bill failure notification did not send");
  }
}

/**
 * Attempt one off-session charge against the customer's default saved card.
 *
 * Every precondition failure is a clean "skipped" rather than an error, a
 * profile whose customer has no card is a normal state, not a fault. Terminal
 * failures leave the invoice `sent` with its payment link emailed, so the
 * customer can always pay by hand.
 */
export async function attemptAutoBill(
  invoiceId: string,
  opts: { recurringId?: string; attemptNo?: number } = {},
): Promise<AutoBillOutcome> {
  const attemptNo = opts.attemptNo ?? 1;

  const invoice = getInvoice(invoiceId);
  if (!invoice)
    return { status: "skipped", errorCode: "invoice_not_found", emailedPaymentLink: false };
  if (["draft", "voided", "paid", "complete"].includes(invoice.status)) {
    return {
      status: "skipped",
      errorCode: `invoice_status_${invoice.status}`,
      emailedPaymentLink: false,
    };
  }

  const balanceDue = invoice.total - (invoice.amount_paid || 0);
  if (balanceDue <= 0) {
    return { status: "skipped", errorCode: "no_balance_due", emailedPaymentLink: false };
  }

  const method = getDefaultMethod(invoice.customer_id);
  if (!method)
    return { status: "skipped", errorCode: "no_saved_method", emailedPaymentLink: false };

  const gateway = getGateway(method.gateway);
  if (!gateway?.supportsAutoBill || !gateway.chargeOffSession) {
    return { status: "skipped", errorCode: "gateway_cannot_auto_bill", emailedPaymentLink: false };
  }

  const result = await gateway.chargeOffSession({
    invoiceId,
    amount: balanceDue,
    currency: invoice.currency,
    gatewayCustomerId: method.gateway_customer_id,
    gatewayMethodId: method.gateway_method_id,
    attemptNo,
  });

  // Only a soft failure with attempts left is non-terminal.
  const canRetry = result.status === "soft_failed" && attemptNo < MAX_ATTEMPTS;
  const nextRetryAt = canRetry ? isoDaysFromNow(RETRY_OFFSET_DAYS[attemptNo - 1]) : null;

  writeAttempt({
    invoiceId,
    recurringId: opts.recurringId,
    paymentMethodId: method.id,
    attemptNo,
    status: result.status,
    reference: result.reference,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    nextRetryAt,
  });

  if (result.status === "succeeded" && result.reference) {
    // This exact charge (same gateway reference) may already sit in the
    // payments table if a concurrent tick on the same attempt got here first,
    // that is a harmless re-observation of the one real charge, not a second
    // collection. Only check for a genuine double collection, the invoice
    // settled by a DIFFERENT reference while this charge was in flight, when
    // this reference is still new.
    const alreadyRecorded = paymentAlreadyRecorded(invoiceId, result.reference);

    if (!alreadyRecorded) {
      const fresh = getInvoice(invoiceId);
      const freshBalance = fresh ? fresh.total - (fresh.amount_paid || 0) : balanceDue;
      if (freshBalance <= 0) {
        // The invoice was paid through another channel (for example the
        // customer paying the public invoice page) during the round trip to
        // the gateway. The card has genuinely been charged a second time:
        // REFUND REQUIRED at the gateway. Do not record this as a payment,
        // that would only hide the duplicate collection.
        logger.error(
          { invoiceId, reference: result.reference },
          `REFUND REQUIRED: auto-bill charged ${result.reference} for invoice ${invoiceId}, but the invoice was already settled through another channel. Refund this reference at the gateway, do not record it as a payment.`,
        );
        await notifyFailure(
          invoiceId,
          invoice.invoice_number,
          `refund required, reference ${result.reference} charged after the invoice was already settled elsewhere`,
          "capture_unrecorded",
        );
        return { ...result, emailedPaymentLink: false };
      }
    }

    let recorded: { success: boolean; error?: string };
    try {
      recorded = recordPayment(invoiceId, {
        amount: balanceDue,
        payment_date: todayIso(),
        method: "card",
        reference: result.reference,
        notes: "Auto-billed via Stripe",
      });
    } catch (err) {
      if (!isUniqueConstraintViolation(err)) throw err;
      // ux_payments_invoice_reference rejected a duplicate (invoice_id,
      // reference). A concurrent tick already recorded this exact charge:
      // a no-op, not a fault.
      recorded = { success: true };
    }

    if (!recorded.success) {
      // The card was charged but the invoice cannot take the payment. Give
      // this at least as much visibility as a decline: money actually left
      // the customer's card and needs reconciling, so notify the merchant
      // as well as logging it.
      logger.error(
        { invoiceId, reference: result.reference, error: recorded.error },
        "Auto-bill charge captured but not recorded",
      );
      await notifyFailure(
        invoiceId,
        invoice.invoice_number,
        `charge captured but not recorded (${recorded.error ?? "unknown error"}), reference ${result.reference}`,
        "capture_unrecorded",
      );
    }
    return { ...result, emailedPaymentLink: false };
  }

  // Terminal failure: hand the customer a way to pay, and tell the merchant.
  let emailedPaymentLink = false;
  if (!canRetry) {
    emailedPaymentLink = true;
    try {
      await sendInvoiceEmail(invoiceId, { attachEinvoice: true });
    } catch (err) {
      logger.warn({ err, invoiceId }, "Could not email the payment link after a failed charge");
    }
    await notifyFailure(invoiceId, invoice.invoice_number, result.errorCode ?? result.status);
  }

  return { ...result, emailedPaymentLink };
}

/**
 * Re-run every attempt whose retry time has passed. The hourly scheduler means
 * a "+1 day" retry fires within an hour of its due time, which is ample for
 * dunning. Retrying the highest logged attempt number keeps the sequence and
 * the idempotency key monotonic.
 */
export async function processAutoBillRetries(): Promise<{
  retried: number;
  succeeded: number;
}> {
  const db = getDb();
  const now = new Date().toISOString();
  const due = db
    .query(
      `SELECT invoice_id, recurring_id, MAX(attempt_no) AS attempt_no
       FROM auto_bill_attempts
       WHERE next_retry_at IS NOT NULL AND next_retry_at <= ?
       GROUP BY invoice_id`,
    )
    .all(now) as { invoice_id: string; recurring_id: string | null; attempt_no: number }[];

  let retried = 0;
  let succeeded = 0;

  for (const row of due) {
    try {
      const result = await attemptAutoBill(row.invoice_id, {
        recurringId: row.recurring_id ?? undefined,
        attemptNo: row.attempt_no + 1,
      });
      retried++;
      if (result.status === "succeeded") succeeded++;

      // The old row is settled either way: its successor now owns the schedule.
      db.run(
        `UPDATE auto_bill_attempts SET next_retry_at = NULL
         WHERE invoice_id = ? AND attempt_no = ?`,
        [row.invoice_id, row.attempt_no],
      );
    } catch (err) {
      logger.error({ err, invoiceId: row.invoice_id }, "Auto-bill retry threw");
      db.run(
        `UPDATE auto_bill_attempts SET next_retry_at = NULL
         WHERE invoice_id = ? AND attempt_no = ?`,
        [row.invoice_id, row.attempt_no],
      );
    }
  }

  return { retried, succeeded };
}
