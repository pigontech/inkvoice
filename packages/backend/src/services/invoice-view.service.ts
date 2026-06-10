import type { InvoiceWithItems } from "../types/invoice";
import { logActivity } from "./activity.service";
import { dispatchEvent } from "./outgoing-webhooks.service";
import { getAllSettings, getSetting } from "./settings.service";

/**
 * Side effects fired the first time a client views an invoice: an activity-log
 * entry (which feeds the in-app notifications bell), an `invoice.viewed`
 * outgoing webhook, and — if the user opted in — an email to the business.
 * All best-effort; a failure here never affects the client's page load.
 */
export async function notifyInvoiceViewed(invoice: InvoiceWithItems): Promise<void> {
  const customerName = invoice.customer?.name ?? null;

  logActivity({
    user_id: null,
    user_name: "Client",
    action: "viewed",
    resource_type: "invoice",
    resource_id: invoice.id,
    metadata: { invoice_number: invoice.invoice_number, customer_name: customerName },
  });

  void dispatchEvent("invoice.viewed", {
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    total: invoice.total,
    currency: invoice.currency,
    customer_name: customerName,
  });

  if (getSetting("notify_on_invoice_view") !== "true") return;

  try {
    const { isEmailConfigured, sendEmail } = await import("./email.service");
    if (!(await isEmailConfigured())) return;
    const settings = getAllSettings();
    const to = settings.company_email;
    if (!to) return;
    const { invoiceViewedEmail } = await import("./email-templates");
    const tpl = invoiceViewedEmail({
      company_name: settings.company_name || "Inkvoice",
      invoice_number: invoice.invoice_number,
      customer_name: customerName || "your customer",
    });
    await sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text });
  } catch {
    // Best-effort notification — swallow errors.
  }
}
