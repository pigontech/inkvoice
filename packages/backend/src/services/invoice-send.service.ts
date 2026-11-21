import { formatCurrency } from "../utils/currency";
import { formatDateStr } from "../utils/date";
import { getEnv } from "../utils/env";
import { logger } from "../utils/logger";
import { isEmailConfigured, type MailResult, sendEmail } from "./email.service";
import { invoiceDeliveryEmail } from "./email-templates";
import * as invoiceService from "./invoice.service";
import { getAllSettings } from "./settings.service";

export interface SendInvoiceOptions {
  to?: string;
  cc?: string[];
  subject?: string;
  message?: string;
  from?: string;
  replyTo?: string;
  /** Request origin when there is one. The scheduler has no request. */
  origin?: string;
}

export type SendInvoiceResult =
  | Extract<MailResult, { success: true }>
  | {
      success: false;
      error: string;
      status: 400 | 404 | 502;
      delivery_state?: "failed" | "unknown";
    };

/**
 * Public origin for share links. A live request's origin wins, otherwise fall
 * back to PUBLIC_BASE_URL so scheduler-sent mail still carries a payment link.
 */
export function resolvePublicOrigin(requestOrigin?: string): string {
  if (requestOrigin) return requestOrigin;
  return getEnv().PUBLIC_BASE_URL || "";
}

export async function sendInvoiceEmail(
  invoiceId: string,
  opts: SendInvoiceOptions = {},
): Promise<SendInvoiceResult> {
  if (!(await isEmailConfigured())) {
    return { success: false, error: "Email is not configured", status: 400 };
  }

  const invoice = invoiceService.getInvoice(invoiceId);
  if (!invoice) return { success: false, error: "Invoice not found", status: 404 };

  const customerEmail = opts.to || invoice.customer?.email;
  if (!customerEmail) {
    return { success: false, error: "No recipient email address", status: 400 };
  }

  const finalised = invoiceService.finaliseForSending(invoice.id) ?? invoice;

  const settings = getAllSettings();
  const origin = resolvePublicOrigin(opts.origin);
  if (!origin) {
    // Neither a live request origin nor PUBLIC_BASE_URL is available, so this
    // email will ship with no link to view or pay the invoice. This is the
    // normal shape for scheduler-sent mail (no request to read an origin
    // from) on a stock install that never set PUBLIC_BASE_URL, so warn rather
    // than silently mailing a dead end.
    logger.warn(
      { invoiceId: finalised.id },
      "PUBLIC_BASE_URL is not set, this email has no link to view or pay the invoice. Set PUBLIC_BASE_URL so scheduler-sent mail can include one.",
    );
  }
  const publicUrl =
    finalised.share_token && origin ? `${origin}/public/invoice/${finalised.share_token}` : null;

  const localeOverride = finalised.locale || finalised.customer?.language || undefined;
  const numberFormat = settings.number_format || undefined;
  const dateFormat = settings.date_format || undefined;

  const email = invoiceDeliveryEmail({
    company_name: settings.company_name || "Inkvoice",
    customer_name: finalised.customer?.name || "Customer",
    invoice_number: finalised.invoice_number,
    total: formatCurrency(finalised.total, finalised.currency, numberFormat, localeOverride),
    currency: finalised.currency,
    due_date: finalised.due_date
      ? formatDateStr(finalised.due_date, dateFormat, localeOverride)
      : null,
    public_url: publicUrl,
    custom_message: opts.message,
  });

  const result = await sendEmail({
    to: customerEmail,
    cc: opts.cc,
    subject: opts.subject || email.subject,
    html: email.html,
    text: email.text,
    from: opts.from?.trim() || undefined,
    replyTo: opts.replyTo?.trim() || undefined,
  });

  if (!result.success) {
    const msg = result.error || "Email could not be delivered";
    const lower = msg.toLowerCase();
    const status =
      msg === "SMTP is not configured" || lower.includes("recipient") || lower.includes("address")
        ? 400
        : 502;
    return { success: false, error: msg, status, delivery_state: result.delivery_state };
  }

  return result;
}
