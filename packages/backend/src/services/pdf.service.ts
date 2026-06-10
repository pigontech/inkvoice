import Mustache from "mustache";
import { getDb } from "../database/connection";
import type { Customer } from "../types/customer";
import { formatCurrency } from "../utils/currency";
import { qrToDataUri } from "../utils/qr-code";
import { getInvoice } from "./invoice.service";
import { getQuote } from "./quote.service";
import { getAllSettings } from "./settings.service";
import { getDefaultTemplate, getTemplate } from "./template.service";

function formatDateStr(dateStr: string, dateFormat?: string, localeOverride?: string): string {
  const d = new Date(dateStr);
  if (dateFormat && !localeOverride) {
    const yyyy = d.getFullYear().toString();
    const mm = (d.getMonth() + 1).toString().padStart(2, "0");
    const dd = d.getDate().toString().padStart(2, "0");
    return dateFormat.replace("YYYY", yyyy).replace("MM", mm).replace("DD", dd);
  }
  return d.toLocaleDateString(localeOverride || "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function buildWatermarkContext(
  settings: Record<string, string>,
  status: string,
): { enabled: boolean; image: string; status: string } | null {
  const enabled = settings.watermark_enabled === "true" && !!settings.watermark_image;
  if (!enabled) return null;
  return {
    enabled: true,
    image: settings.watermark_image,
    status,
  };
}

/**
 * Build a QR code (as a data URI) pointing at the public share URL, if the
 * tenant has opted into PDF QR codes, configured a public base URL, and the
 * document has been published (has a share token).
 */
function buildQrContext(
  settings: Record<string, string>,
  shareToken: string | null | undefined,
  kind: "invoice" | "quote",
): { url: string; image: string } | null {
  if (settings.pdf_qr_code_enabled !== "true") return null;
  const baseUrl = (settings.public_url || "").trim().replace(/\/$/, "");
  if (!baseUrl || !shareToken) return null;
  const url = `${baseUrl}/public/${kind}/${shareToken}`;
  try {
    return { url, image: qrToDataUri(url) };
  } catch {
    return null;
  }
}

function resolveCountryName(countryCode: string | null | undefined, locale: string): string | null {
  const code = (countryCode || "").trim();
  if (!code) return null;
  try {
    const dn = new Intl.DisplayNames([locale], { type: "region" });
    return dn.of(code.toUpperCase()) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export function buildInvoiceContext(invoiceId: string) {
  const invoice = getInvoice(invoiceId);
  if (!invoice) return null;

  const settings = getAllSettings();
  const db = getDb();
  const customer = db
    .query("SELECT * FROM customers WHERE id = ?")
    .get(invoice.customer_id) as Customer | null;

  // Locale precedence: explicit invoice locale > customer language > tenant default.
  // The customer override lets you bill an international customer in their
  // language without setting it on every invoice.
  const customerLanguage = customer?.language || undefined;
  const locale = invoice.locale || customerLanguage || settings.locale || "en-US";
  const localeOverride = invoice.locale || customerLanguage || undefined;

  // Batch-fetch all referenced tax definitions upfront (avoids N+1)
  const taxDefIds = [...new Set(invoice.items.filter((i) => i.tax_id).map((i) => i.tax_id!))];
  const taxDefNames = new Map<string, string>();
  for (const taxId of taxDefIds) {
    const def = db.query("SELECT name FROM tax_definitions WHERE id = ?").get(taxId) as {
      name: string;
    } | null;
    if (def) taxDefNames.set(taxId, def.name);
  }

  // Build tax summary
  const taxMap = new Map<string, { name: string; rate: number; amount: number }>();
  for (const item of invoice.items) {
    if (item.tax_rate > 0) {
      const key = `${item.tax_rate}`;
      const existing = taxMap.get(key);
      if (existing) {
        existing.amount += item.tax_amount;
      } else {
        taxMap.set(key, {
          name: (item.tax_id && taxDefNames.get(item.tax_id)) || `Tax ${item.tax_rate}%`,
          rate: item.tax_rate,
          amount: item.tax_amount,
        });
      }
    }
  }

  const currency = invoice.currency || settings.currency || "USD";
  const dateFormat = settings.date_format || undefined;
  const numberFormat = settings.number_format || undefined;

  return {
    invoice_number: invoice.invoice_number,
    issue_date: formatDateStr(invoice.issue_date, dateFormat, localeOverride),
    due_date: invoice.due_date ? formatDateStr(invoice.due_date, dateFormat, localeOverride) : null,
    status: invoice.status,
    company: {
      name: settings.company_name || "",
      email: settings.company_email || "",
      phone: settings.company_phone || "",
      address: (settings.company_address || "").replace(/\n/g, "<br>"),
      tax_id: settings.company_tax_id || "",
      logo: settings.company_logo || "",
      bank_details: (settings.company_bank_details ?? "").replace(/\n/g, "<br>"),
    },
    watermark: buildWatermarkContext(settings, invoice.status),
    qr: buildQrContext(settings, invoice.share_token, "invoice"),
    customer: customer
      ? {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          address_line1: customer.address_line1,
          address_line2: customer.address_line2,
          city: customer.city,
          state: customer.state,
          postal_code: customer.postal_code,
          country: customer.country,
          country_name: resolveCountryName(customer.country, locale),
          tax_id: customer.tax_id,
        }
      : {},
    items: invoice.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unit_price,
      formatted_unit_price: formatCurrency(item.unit_price, currency, numberFormat, localeOverride),
      tax_rate: item.tax_rate,
      line_total: item.line_total,
      formatted_line_total: formatCurrency(item.line_total, currency, numberFormat, localeOverride),
    })),
    formatted_subtotal: formatCurrency(invoice.subtotal, currency, numberFormat, localeOverride),
    has_discount: invoice.discount_amount > 0,
    formatted_discount: formatCurrency(
      invoice.discount_amount,
      currency,
      numberFormat,
      localeOverride,
    ),
    tax_summary: Array.from(taxMap.values()).map((t) => ({
      name: t.name,
      rate: t.rate,
      formatted_amount: formatCurrency(t.amount, currency, numberFormat, localeOverride),
    })),
    formatted_total: formatCurrency(invoice.total, currency, numberFormat, localeOverride),
    payment_terms: invoice.payment_terms,
    notes: invoice.notes,
    currency,
  };
}

function injectPrintStyles(html: string): string {
  // Only inject @page if the template doesn't already define one
  const hasPageRule = /@page\s*\{/.test(html);
  const pageRule = hasPageRule ? "" : "@page { size: A4; margin: 10mm; }";
  const styles = `<style>${pageRule} *, *::before, *::after { box-sizing: border-box; }</style>`;
  if (html.includes("</head>")) {
    return html.replace("</head>", `${styles}</head>`);
  }
  return `${styles}${html}`;
}

export function renderInvoiceHtml(invoiceId: string): string | null {
  const context = buildInvoiceContext(invoiceId);
  if (!context) return null;

  const invoice = getInvoice(invoiceId);
  // Resolution order: explicit invoice template > per-customer default > tenant default.
  // The per-customer override lets you bill a customer in a specific template
  // (e.g. their preferred branding) without setting it on every invoice.
  let template = invoice?.template_id ? getTemplate(invoice.template_id) : null;
  if (!template && invoice) {
    const db = getDb();
    const customer = db
      .query("SELECT default_template_id FROM customers WHERE id = ?")
      .get(invoice.customer_id) as { default_template_id: string | null } | null;
    if (customer?.default_template_id) {
      template = getTemplate(customer.default_template_id);
    }
  }
  if (!template) template = getDefaultTemplate();
  if (!template) return null;

  return injectPrintStyles(Mustache.render(template.html_content, context));
}

export function buildQuoteContext(quoteId: string) {
  const quote = getQuote(quoteId);
  if (!quote) return null;

  const settings = getAllSettings();
  const db = getDb();
  const customer = db
    .query("SELECT * FROM customers WHERE id = ?")
    .get(quote.customer_id) as Customer | null;

  // Locale precedence matches buildInvoiceContext: explicit > customer > tenant default.
  const customerLanguage = customer?.language || undefined;
  const locale = quote.locale || customerLanguage || settings.locale || "en-US";
  const localeOverride = quote.locale || customerLanguage || undefined;

  const taxDefIds = [...new Set(quote.items.filter((i) => i.tax_id).map((i) => i.tax_id!))];
  const taxDefNames = new Map<string, string>();
  for (const taxId of taxDefIds) {
    const def = db.query("SELECT name FROM tax_definitions WHERE id = ?").get(taxId) as {
      name: string;
    } | null;
    if (def) taxDefNames.set(taxId, def.name);
  }

  const taxMap = new Map<string, { name: string; rate: number; amount: number }>();
  for (const item of quote.items) {
    if (item.tax_rate > 0) {
      const key = `${item.tax_rate}`;
      const existing = taxMap.get(key);
      if (existing) existing.amount += item.tax_amount;
      else
        taxMap.set(key, {
          name: (item.tax_id && taxDefNames.get(item.tax_id)) || `Tax ${item.tax_rate}%`,
          rate: item.tax_rate,
          amount: item.tax_amount,
        });
    }
  }

  const currency = quote.currency || settings.currency || "USD";
  const dateFormat = settings.date_format || undefined;
  const numberFormat = settings.number_format || undefined;

  return {
    // Use invoice_number so existing templates work for quotes too
    invoice_number: quote.quote_number,
    issue_date: formatDateStr(quote.issue_date, dateFormat, localeOverride),
    due_date: quote.valid_until
      ? formatDateStr(quote.valid_until, dateFormat, localeOverride)
      : null,
    status: quote.status,
    is_quote: true,
    document_title: "Quote",
    company: {
      name: settings.company_name || "",
      email: settings.company_email || "",
      phone: settings.company_phone || "",
      address: (settings.company_address || "").replace(/\n/g, "<br>"),
      tax_id: settings.company_tax_id || "",
      logo: settings.company_logo || "",
      bank_details: (settings.company_bank_details ?? "").replace(/\n/g, "<br>"),
    },
    watermark: buildWatermarkContext(settings, quote.status),
    qr: buildQrContext(settings, quote.share_token, "quote"),
    customer: customer
      ? {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          address_line1: customer.address_line1,
          address_line2: customer.address_line2,
          city: customer.city,
          state: customer.state,
          postal_code: customer.postal_code,
          country: customer.country,
          country_name: resolveCountryName(customer.country, locale),
          tax_id: customer.tax_id,
        }
      : {},
    items: quote.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unit_price,
      formatted_unit_price: formatCurrency(item.unit_price, currency, numberFormat, localeOverride),
      tax_rate: item.tax_rate,
      line_total: item.line_total,
      formatted_line_total: formatCurrency(item.line_total, currency, numberFormat, localeOverride),
    })),
    formatted_subtotal: formatCurrency(quote.subtotal, currency, numberFormat, localeOverride),
    has_discount: quote.discount_amount > 0,
    formatted_discount: formatCurrency(
      quote.discount_amount,
      currency,
      numberFormat,
      localeOverride,
    ),
    tax_summary: Array.from(taxMap.values()).map((t) => ({
      name: t.name,
      rate: t.rate,
      formatted_amount: formatCurrency(t.amount, currency, numberFormat, localeOverride),
    })),
    formatted_total: formatCurrency(quote.total, currency, numberFormat, localeOverride),
    notes: quote.notes,
    currency,
  };
}

export function renderQuoteHtml(quoteId: string): string | null {
  const context = buildQuoteContext(quoteId);
  if (!context) return null;

  const quote = getQuote(quoteId);
  // Resolution order: explicit quote template > per-customer default > tenant default.
  let template = quote?.template_id ? getTemplate(quote.template_id) : null;
  if (!template && quote) {
    const db = getDb();
    const customer = db
      .query("SELECT default_template_id FROM customers WHERE id = ?")
      .get(quote.customer_id) as { default_template_id: string | null } | null;
    if (customer?.default_template_id) {
      template = getTemplate(customer.default_template_id);
    }
  }
  if (!template) template = getDefaultTemplate();
  if (!template) return null;

  return injectPrintStyles(Mustache.render(template.html_content, context));
}
