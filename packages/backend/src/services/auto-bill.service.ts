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

export type AutoBillOutcome = OffSessionResult | { status: "skipped"; errorCode: string };

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
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
    const msg = String(err);
    if (!msg.includes("UNIQUE") && !msg.includes("constraint")) throw err;
  }
}

/** Best-effort admin notification. Mirrors notifyInvoiceViewed exactly. */
async function notifyFailure(
  invoiceId: string,
  invoiceNumber: string,
  reason: string,
): Promise<void> {
  try {
    logActivity({
      user_id: null,
      user_name: "System",
      action: "auto_bill_failed",
      resource_type: "invoice",
      resource_id: invoiceId,
      metadata: { invoice_number: invoiceNumber, reason },
    });

    void dispatchEvent("invoice.auto_bill_failed", {
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      reason,
    });

    if (getSetting("notify_on_auto_bill_failure") !== "true") return;

    const { isEmailConfigured, sendEmail } = await import("./email.service");
    if (!(await isEmailConfigured())) return;
    const settings = getAllSettings();
    const to = settings.company_email;
    if (!to) return;

    await sendEmail({
      to,
      subject: `Auto-billing failed for invoice ${invoiceNumber}`,
      text: `The saved card for invoice ${invoiceNumber} could not be charged (${reason}). The customer has been emailed a payment link.`,
      html: `<p>The saved card for invoice <strong>${invoiceNumber}</strong> could not be charged (${reason}).</p><p>The customer has been emailed a payment link.</p>`,
    });
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
  if (!invoice) return { status: "skipped", errorCode: "invoice_not_found" };
  if (["draft", "voided", "paid", "complete"].includes(invoice.status)) {
    return { status: "skipped", errorCode: `invoice_status_${invoice.status}` };
  }

  const balanceDue = invoice.total - (invoice.amount_paid || 0);
  if (balanceDue <= 0) return { status: "skipped", errorCode: "no_balance_due" };

  const method = getDefaultMethod(invoice.customer_id);
  if (!method) return { status: "skipped", errorCode: "no_saved_method" };

  const gateway = getGateway(method.gateway);
  if (!gateway?.supportsAutoBill || !gateway.chargeOffSession) {
    return { status: "skipped", errorCode: "gateway_cannot_auto_bill" };
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
    const recorded = recordPayment(invoiceId, {
      amount: balanceDue,
      payment_date: todayIso(),
      method: "card",
      reference: result.reference,
      notes: "Auto-billed via Stripe",
    });
    if (!recorded.success) {
      // The card was charged but the invoice cannot take the payment. Surface
      // loudly so ops can reconcile rather than losing money silently.
      logger.error(
        { invoiceId, reference: result.reference, error: recorded.error },
        "Auto-bill charge captured but not recorded",
      );
    }
    return result;
  }

  // Terminal failure: hand the customer a way to pay, and tell the merchant.
  if (!canRetry) {
    try {
      await sendInvoiceEmail(invoiceId, { attachEinvoice: true });
    } catch (err) {
      logger.warn({ err, invoiceId }, "Could not email the payment link after a failed charge");
    }
    await notifyFailure(invoiceId, invoice.invoice_number, result.errorCode ?? result.status);
  }

  return result;
}
