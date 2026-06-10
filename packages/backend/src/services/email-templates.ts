import Mustache from "mustache";
import { getSetting } from "./settings.service";

interface InvoiceEmailContext {
  company_name: string;
  customer_name: string;
  invoice_number: string;
  total: string;
  currency: string;
  due_date: string | null;
  public_url: string | null;
  custom_message?: string;
}

/**
 * Render an invoice delivery email. If the user has saved
 * `invoice_email_subject` / `invoice_email_body` in settings, those are
 * rendered through Mustache with the same context the bundled template uses.
 * Otherwise we fall back to the bundled HTML template below.
 */
export function invoiceDeliveryEmail(ctx: InvoiceEmailContext): {
  subject: string;
  html: string;
  text: string;
} {
  const fromName = getSetting("email_from_name") || ctx.company_name || "Inkvoice";
  const footer = getSetting("email_footer_text") || "";

  const customSubject = (getSetting("invoice_email_subject") || "").trim();
  const customBody = (getSetting("invoice_email_body") || "").trim();

  if (customSubject && customBody) {
    const view = {
      ...ctx,
      from_name: fromName,
      footer,
    };
    const subject = Mustache.render(customSubject, view);
    const text = Mustache.render(customBody, view);
    // Render plain-text body as HTML by escaping + converting newlines to <br>
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;white-space:pre-wrap;">${escaped.replace(/\n/g, "<br>")}</div>`;
    return { subject, html, text };
  }

  const subject = `Invoice ${ctx.invoice_number} from ${fromName}`;

  const linkHtml = ctx.public_url
    ? `<p><a href="${ctx.public_url}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">View Invoice</a></p>`
    : "";
  const linkText = ctx.public_url ? `\nView invoice: ${ctx.public_url}` : "";

  const messageHtml = ctx.custom_message ? `<p>${ctx.custom_message}</p>` : "";
  const messageText = ctx.custom_message ? `\n${ctx.custom_message}\n` : "";

  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <h2>Invoice ${ctx.invoice_number}</h2>
  ${messageHtml}
  <p>Dear ${ctx.customer_name},</p>
  <p>Please find the details of your invoice below:</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0;">
    <tr><td style="padding:8px 0;color:#666;">Invoice Number</td><td style="padding:8px 0;font-weight:600;">${ctx.invoice_number}</td></tr>
    <tr><td style="padding:8px 0;color:#666;">Total</td><td style="padding:8px 0;font-weight:600;">${ctx.total} ${ctx.currency}</td></tr>
    ${ctx.due_date ? `<tr><td style="padding:8px 0;color:#666;">Due Date</td><td style="padding:8px 0;">${ctx.due_date}</td></tr>` : ""}
  </table>
  ${linkHtml}
  ${footer ? `<hr style="margin:20px 0;border:none;border-top:1px solid #eee;"><p style="color:#999;font-size:12px;">${footer}</p>` : ""}
</div>`.trim();

  const text = `Invoice ${ctx.invoice_number}
${messageText}
Dear ${ctx.customer_name},

Please find the details of your invoice:
- Invoice Number: ${ctx.invoice_number}
- Total: ${ctx.total} ${ctx.currency}
${ctx.due_date ? `- Due Date: ${ctx.due_date}` : ""}
${linkText}
${footer ? `\n---\n${footer}` : ""}`.trim();

  return { subject, html, text };
}

interface StatementEmailContext {
  company_name: string;
  customer_name: string;
  period_from: string;
  period_to: string;
  closing_balance: string;
  opening_balance: string;
  currency: string;
  lines: Array<{
    date: string;
    reference: string;
    description: string;
    charge: string;
    credit: string;
    balance: string;
  }>;
  labels: Record<string, string>;
  custom_message?: string;
}

/** Render an account-statement delivery email with the statement table inline. */
export function statementDeliveryEmail(ctx: StatementEmailContext): {
  subject: string;
  html: string;
  text: string;
} {
  const fromName = getSetting("email_from_name") || ctx.company_name || "Inkvoice";
  const footer = getSetting("email_footer_text") || "";
  const L = ctx.labels;
  const subject = `${L.statement} — ${fromName} (${ctx.period_from} – ${ctx.period_to})`;

  const messageHtml = ctx.custom_message ? `<p>${ctx.custom_message}</p>` : "";

  const rowsHtml = ctx.lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${l.date}</td><td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${l.reference}</td><td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;">${l.description}</td><td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right;">${l.charge}</td><td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right;">${l.credit}</td><td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:right;">${l.balance}</td></tr>`,
    )
    .join("");

  const html = `
<div style="font-family:sans-serif;max-width:680px;margin:0 auto;padding:20px;color:#1a1a1a;">
  <h2>${L.statement}</h2>
  ${messageHtml}
  <p>${L.bill_to}: <strong>${ctx.customer_name}</strong><br>
  <span style="color:#666;">${L.period}: ${ctx.period_from} – ${ctx.period_to}</span></p>
  <p style="font-size:16px;">${L.balance_due}: <strong>${ctx.closing_balance}</strong></p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
    <thead>
      <tr style="color:#888;text-transform:uppercase;font-size:11px;">
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e5e5;">${L.date}</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e5e5;">${L.reference}</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e5e5;">${L.description}</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #e5e5e5;">${L.charges}</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #e5e5e5;">${L.payments_credits}</th>
        <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #e5e5e5;">${L.balance}</th>
      </tr>
    </thead>
    <tbody>
      <tr><td colspan="5" style="padding:6px 8px;font-weight:600;background:#fafafa;">${L.opening_balance}</td><td style="padding:6px 8px;text-align:right;font-weight:600;background:#fafafa;">${ctx.opening_balance}</td></tr>
      ${rowsHtml}
      <tr><td colspan="5" style="padding:6px 8px;font-weight:700;border-top:2px solid #e5e5e5;">${L.closing_balance}</td><td style="padding:6px 8px;text-align:right;font-weight:700;border-top:2px solid #e5e5e5;">${ctx.closing_balance}</td></tr>
    </tbody>
  </table>
  ${footer ? `<hr style="margin:20px 0;border:none;border-top:1px solid #eee;"><p style="color:#999;font-size:12px;">${footer}</p>` : ""}
</div>`.trim();

  const text = `${L.statement} — ${fromName}
${L.bill_to}: ${ctx.customer_name}
${L.period}: ${ctx.period_from} – ${ctx.period_to}
${L.balance_due}: ${ctx.closing_balance}
${footer ? `\n---\n${footer}` : ""}`.trim();

  return { subject, html, text };
}

interface PasswordResetEmailContext {
  email: string;
  reset_url: string;
}

/**
 * Built-in password-reset email for standalone installs, delivered through
 * the configured SMTP server. A hosting deployment typically bypasses this by
 * registering a branded sender via setSystemMailSender().
 */
export function passwordResetEmail(ctx: PasswordResetEmailContext): {
  subject: string;
  html: string;
  text: string;
} {
  const fromName = getSetting("email_from_name") || "Inkvoice";
  const subject = `Reset your ${fromName} password`;

  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">
  <h2>Password reset</h2>
  <p>A password reset was requested for <strong>${ctx.email}</strong>.</p>
  <p><a href="${ctx.reset_url}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Reset password</a></p>
  <p style="color:#666;">This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.</p>
</div>`.trim();

  const text = `Password reset

A password reset was requested for ${ctx.email}.

Reset your password: ${ctx.reset_url}

This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.`;

  return { subject, html, text };
}

interface InvoiceViewedContext {
  company_name: string;
  invoice_number: string;
  customer_name: string;
}

/** Notify the business that a client opened an invoice's public link. */
export function invoiceViewedEmail(ctx: InvoiceViewedContext): {
  subject: string;
  html: string;
  text: string;
} {
  const footer = getSetting("email_footer_text") || "";
  const subject = `Invoice ${ctx.invoice_number} was viewed by ${ctx.customer_name}`;

  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <h2>Invoice viewed</h2>
  <p><strong>${ctx.customer_name}</strong> just opened invoice <strong>${ctx.invoice_number}</strong>.</p>
  <p style="color:#666;">You're receiving this because "notify on invoice view" is enabled in your settings.</p>
  ${footer ? `<hr style="margin:20px 0;border:none;border-top:1px solid #eee;"><p style="color:#999;font-size:12px;">${footer}</p>` : ""}
</div>`.trim();

  const text = `Invoice viewed
${ctx.customer_name} just opened invoice ${ctx.invoice_number}.

You're receiving this because "notify on invoice view" is enabled in your settings.
${footer ? `\n---\n${footer}` : ""}`.trim();

  return { subject, html, text };
}

interface PortalWelcomeContext {
  company_name: string;
  customer_name: string;
  portal_url: string;
}

export function portalWelcomeEmail(ctx: PortalWelcomeContext): {
  subject: string;
  html: string;
  text: string;
} {
  const fromName = getSetting("email_from_name") || ctx.company_name || "Inkvoice";
  const footer = getSetting("email_footer_text") || "";
  const subject = `Your invoice portal at ${fromName}`;

  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <h2>Welcome, ${ctx.customer_name}</h2>
  <p>${fromName} has enabled a private portal where you can view all your invoices in one place, download copies, and message us if anything looks off.</p>
  <p><a href="${ctx.portal_url}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Open my portal</a></p>
  <p style="color:#666;font-size:13px;">Bookmark this link — it doesn't require a password and will remain valid as long as portal access is on.</p>
  ${footer ? `<hr style="margin:20px 0;border:none;border-top:1px solid #eee;"><p style="color:#999;font-size:12px;">${footer}</p>` : ""}
</div>`.trim();

  const text = `Welcome, ${ctx.customer_name}
${fromName} has enabled a private portal where you can view all your invoices, download copies, and message us.

Open your portal: ${ctx.portal_url}

This link doesn't require a password and remains valid as long as portal access is on.
${footer ? `\n---\n${footer}` : ""}`.trim();

  return { subject, html, text };
}
