import { getDb } from "../database/connection";
import { getAllSettings } from "../services/settings.service";
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
           c.siren as customer_siren, c.siret as customer_siret
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
    // Fallback: aggregate from items by rate
    const byRate = new Map<number, { taxable: number; tax: number; code: string; name: string }>();
    for (const item of items) {
      const existing = byRate.get(item.tax_rate) || {
        taxable: 0,
        tax: 0,
        code: item.tax_category_code,
        name: `Tax ${item.tax_rate}%`,
      };
      existing.taxable += item.line_total;
      existing.tax += item.tax_amount;
      byRate.set(item.tax_rate, existing);
    }
    tax_breakdown = Array.from(byRate.entries()).map(([rate, data]) => ({
      tax_name: data.name,
      tax_rate: rate,
      category_code: data.code,
      taxable_amount: data.taxable,
      tax_amount: data.tax,
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
    currency: (invoice.currency as string) || "EUR",
    locale: invoice.locale as string | null,
    type: (invoice.type as "invoice" | "credit_note") || "invoice",
    notes: (invoice.notes as string) || null,
    payment_terms: (invoice.payment_terms as string) || null,
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
      contact_name: settings.company_contact_name || null,
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
    items,
    tax_breakdown,
  };
}

/** EN 16931 VAT category by rate for German-style invoices. */
function defaultCategoryForRate(rate: number): string {
  if (rate === 0) return "Z";
  if (rate === 7) return "AA";
  return "S";
}
