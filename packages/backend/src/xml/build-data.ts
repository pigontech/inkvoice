import { getDb } from "../database/connection";
import { getAllSettings } from "../services/settings.service";
import { localizePaymentTerms } from "../utils/payment-terms";
import { taxByRate } from "../utils/tax-calculator";
import type { XmlInvoiceData, XmlLineItem, XmlTaxBreakdown } from "./types";

export function buildXmlInvoiceData(invoiceId: string): XmlInvoiceData {
  const db = getDb();
  const settings = getAllSettings();

  const invoice = db
    .query(`
    SELECT i.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
           c.address_line1, c.address_line2, c.city, c.state, c.postal_code, c.country,
           c.tax_id as customer_tax_id, c.tax_number as customer_tax_number,
           c.einvoice_format as customer_einvoice_format, c.leitweg_id as customer_leitweg_id,
           c.einvoice_receiver_id as customer_einvoice_receiver_id,
           c.einvoice_receiver_scheme as customer_einvoice_receiver_scheme,
           c.siren as customer_siren, c.siret as customer_siret, c.language as customer_language
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    WHERE i.id = ?
  `)
    .get(invoiceId) as Record<string, unknown>;

  if (!invoice) throw new Error("Invoice not found");

  const rawItems = db
    .query(`
    SELECT ii.*, td.category_code, td.name as tax_name
    FROM invoice_items ii
    LEFT JOIN tax_definitions td ON ii.tax_id = td.id
    WHERE ii.invoice_id = ?
    ORDER BY ii.sort_order
  `)
    .all(invoiceId) as any[];

  const items: XmlLineItem[] = rawItems.map((it: any) => ({
    id: it.id,
    description: it.description,
    quantity: it.quantity,
    unit_price: it.unit_price,
    unit: it.unit || "piece",
    line_total: it.line_total,
    tax_rate: it.tax_rate || 0,
    tax_amount: it.tax_amount || 0,
    tax_category_code: it.category_code || defaultCategoryForRate(it.tax_rate || 0),
    tax_name: it.tax_name || null,
  }));

  // Build tax breakdown from invoice_taxes if available, otherwise aggregate from items.
  let tax_breakdown: XmlTaxBreakdown[];
  const auditTaxes = db
    .query("SELECT * FROM invoice_taxes WHERE invoice_id = ?")
    .all(invoiceId) as any[];

  if (auditTaxes.length > 0) {
    tax_breakdown = auditTaxes.map((t: any) => ({
      tax_name: t.tax_name,
      tax_rate: t.tax_rate,
      category_code: t.category_code || defaultCategoryForRate(t.tax_rate),
      taxable_amount: t.taxable_amount,
      tax_amount: t.tax_amount,
    }));
  } else {
    // Fallback: aggregate from items by rate, with the document discount taken
    // off each rate's taxable amount and VAT (as the calculator does).
    const codeByRate = new Map<number, string>();
    for (const item of items) {
      if (!codeByRate.has(item.tax_rate)) codeByRate.set(item.tax_rate, item.tax_category_code);
    }
    tax_breakdown = taxByRate(items, Number(invoice.discount_amount) || 0).map((r) => ({
      tax_name: `Tax ${r.rate}%`,
      tax_rate: r.rate,
      category_code: codeByRate.get(r.rate) || defaultCategoryForRate(r.rate),
      taxable_amount: Math.round((r.net - r.discount) * 100) / 100,
      tax_amount: r.tax,
    }));
  }

  // Kleinunternehmer (§ 19 UStG) → no VAT, categories come out as exempt.
  const kleinunternehmer = settings.einvoice_kleinunternehmer === "true";
  // Franchise en base de TVA (art. 293 B CGI) → zero VAT with exemption reason.
  const franchiseFr = settings.einvoice_franchise_fr === "true";
  // France network enabled → drive FR-specific validation.
  const franceEnabled = settings.france_enabled === "true";

  return {
    invoice_number: String(invoice.invoice_number),
    issue_date: String(invoice.issue_date),
    due_date: invoice.due_date ? String(invoice.due_date) : null,
    service_date: invoice.service_date ? String(invoice.service_date) : null,
    service_period:
      invoice.service_period_start && invoice.service_period_end
        ? {
            start: String(invoice.service_period_start),
            end: String(invoice.service_period_end),
          }
        : null,
    currency: (invoice.currency as string) || "EUR",
    locale: invoice.locale as string | null,
    type: (invoice.type as "invoice" | "credit_note") || "invoice",
    notes: (invoice.notes as string) || null,
    // In the invoice's language, chosen as for the PDF: invoice > customer > workspace.
    payment_terms: localizePaymentTerms(
      invoice.payment_terms as string | null,
      (invoice.locale as string) || (invoice.customer_language as string) || settings.locale,
    ),
    subtotal: Number(invoice.subtotal) || 0,
    tax_total: Number(invoice.tax_total) || 0,
    discount_amount: Number(invoice.discount_amount) || 0,
    total: Number(invoice.total) || 0,
    kleinunternehmer,
    franchise_fr: franchiseFr,
    france_enabled: franceEnabled,
    supplier: {
      name: settings.company_name || "",
      email: settings.company_email || null,
      phone: settings.company_phone || null,
      address: settings.company_address || null,
      street: settings.company_street || null,
      city: settings.company_city || null,
      postal_code: settings.company_postal_code || null,
      country: (settings.company_country || "").toUpperCase() || null,
      tax_id: settings.company_tax_id || null,
      tax_number: settings.company_tax_number || null,
      bank_details: settings.company_bank_details || null,
      iban: settings.company_iban || null,
      bic: settings.company_bic || null,
      account_holder: settings.company_account_holder || null,
      peppol_endpoint_id: settings.company_peppol_id || null,
      peppol_scheme_id: settings.company_peppol_scheme || null,
    },
    customer: {
      name: (invoice.customer_name as string) || "",
      email: (invoice.customer_email as string) || null,
      phone: (invoice.customer_phone as string) || null,
      address_line1: (invoice.address_line1 as string) || null,
      address_line2: (invoice.address_line2 as string) || null,
      city: (invoice.city as string) || null,
      state: (invoice.state as string) || null,
      postal_code: (invoice.postal_code as string) || null,
      country: (invoice.country as string) || null,
      tax_id: (invoice.customer_tax_id as string) || null,
      tax_number: (invoice.customer_tax_number as string) || null,
      einvoice_format: (invoice.customer_einvoice_format as string) || null,
      leitweg_id: (invoice.customer_leitweg_id as string) || null,
      einvoice_receiver_id: (invoice.customer_einvoice_receiver_id as string) || null,
      einvoice_receiver_scheme: (invoice.customer_einvoice_receiver_scheme as string) || null,
      siren: (invoice.customer_siren as string) || null,
      siret: (invoice.customer_siret as string) || null,
    },
    preceding_invoice: precedingInvoice(invoice.reference_invoice_id as string | null),
    items,
    tax_breakdown,
  };
}

/** The invoice a credit note refers to (BT-25/BT-26). */
function precedingInvoice(id: string | null): XmlInvoiceData["preceding_invoice"] {
  if (!id) return null;
  const row = getDb()
    .query("SELECT invoice_number, issue_date FROM invoices WHERE id = ?")
    .get(id) as { invoice_number: string; issue_date: string | null } | null;
  return row ? { number: row.invoice_number, issue_date: row.issue_date } : null;
}

/** EN 16931 VAT category by rate (German 7 % is standard rated, "S"). */
function defaultCategoryForRate(rate: number): string {
  if (rate === 0) return "Z";
  return "S";
}
