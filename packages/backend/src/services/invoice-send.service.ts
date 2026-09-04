import { formatCurrency } from "../utils/currency";
import { getEnv } from "../utils/env";
import { logger } from "../utils/logger";
import { emitEinvoice } from "./einvoice.service";
import { isEmailConfigured, sendEmail } from "./email.service";
import { invoiceDeliveryEmail } from "./email-templates";
import * as invoiceService from "./invoice.service";
import { getAllSettings } from "./settings.service";

export interface SendInvoiceOptions {
  to?: string;
  subject?: string;
  message?: string;
  from?: string;
  replyTo?: string;
  attachEinvoice?: boolean;
  /** Request origin when there is one. The scheduler has no request. */
  origin?: string;
}

export type SendInvoiceResult =
  | { success: true }
  | { success: false; error: string; status: 400 | 404 | 502 };

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
  const publicUrl =
    finalised.share_token && origin ? `${origin}/public/invoice/${finalised.share_token}` : null;

  const email = invoiceDeliveryEmail({
    company_name: settings.company_name || "Inkvoice",
    customer_name: finalised.customer?.name || "Customer",
    invoice_number: finalised.invoice_number,
    total: formatCurrency(finalised.total, finalised.currency),
    currency: finalised.currency,
    due_date: finalised.due_date,
    public_url: publicUrl,
    custom_message: opts.message,
  });

  // E-invoice delivery: attach the ZUGFeRD hybrid PDF (or XRechnung XML) when
  // the workspace uses e-invoicing. Errors must not block the plain email.
  const attachments: Array<{
    filename: string;
    content: Buffer | Uint8Array;
    contentType: string;
  }> = [];
  const wantEinvoice = opts.attachEinvoice !== false && !!settings.einvoice_enabled;
  if (wantEinvoice) {
    try {
      const emitted = await emitEinvoice(finalised.id);
      if (emitted.pdf) {
        attachments.push({
          filename: `${finalised.invoice_number}-zugferd.pdf`,
          content: emitted.pdf,
          contentType: "application/pdf",
        });
      } else {
        attachments.push({
          filename: `${finalised.invoice_number}-${emitted.format}.xml`,
          content: Buffer.from(emitted.xml, "utf-8"),
          contentType: "application/xml",
        });
      }
    } catch (err: any) {
      logger.warn(`E-invoice emission failed for invoice ${finalised.id}: ${err.message}`);
    }
  }

  const result = await sendEmail({
    to: customerEmail,
    subject: opts.subject || email.subject,
    html: email.html,
    text: email.text,
    from: opts.from?.trim() || undefined,
    replyTo: opts.replyTo?.trim() || undefined,
    attachments,
  });

  if (!result.success) {
    const msg = result.error || "Email could not be delivered";
    const lower = msg.toLowerCase();
    const status =
      msg === "SMTP is not configured" || lower.includes("recipient") || lower.includes("address")
        ? 400
        : 502;
    return { success: false, error: msg, status };
  }

  return { success: true };
}
