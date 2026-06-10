import { getDb } from "../database/connection";
import { getAllSettings } from "../services/settings.service";
import type { XmlInvoiceData, XmlLineItem, XmlTaxBreakdown } from "./types";

export function buildXmlInvoiceData(invoiceId: string): XmlInvoiceData {
  const db = getDb();
  const settings = getAllSettings();

  const invoice = db
    .query(`
    SELECT i.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
           c.address_line1, c.city, c.state, c.postal_code, c.country, c.tax_id as customer_tax_id
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    WHERE i.id = ?
  `)
    .get(invoiceId) as any;

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
    tax_category_code: it.category_code || "S",
  }));

  // Build tax breakdown from invoice_taxes if available, otherwise aggregate from items
  let tax_breakdown: XmlTaxBreakdown[];
  const auditTaxes = db
    .query("SELECT * FROM invoice_taxes WHERE invoice_id = ?")
    .all(invoiceId) as any[];

  if (auditTaxes.length > 0) {
    tax_breakdown = auditTaxes.map((t: any) => ({
      tax_name: t.tax_name,
      tax_rate: t.tax_rate,
      category_code: t.category_code || "S",
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

  return {
    invoice_number: invoice.invoice_number,
    issue_date: invoice.issue_date,
    due_date: invoice.due_date,
    currency: invoice.currency || "USD",
    locale: invoice.locale,
    type: invoice.type || "invoice",
    notes: invoice.notes,
    payment_terms: invoice.payment_terms,
    subtotal: invoice.subtotal,
    tax_total: invoice.tax_total,
    discount_amount: invoice.discount_amount || 0,
    total: invoice.total,
    supplier: {
      name: settings.company_name || "",
      email: settings.company_email || null,
      phone: settings.company_phone || null,
      address: settings.company_address || null,
      tax_id: settings.company_tax_id || null,
      country: null,
      bank_details: settings.company_bank_details || null,
      peppol_endpoint_id: settings.peppol_endpoint_id || null,
      peppol_scheme_id: settings.peppol_scheme_id || null,
    },
    customer: {
      name: invoice.customer_name || "",
      email: invoice.customer_email || null,
      phone: invoice.customer_phone || null,
      address_line1: invoice.address_line1 || null,
      city: invoice.city || null,
      state: invoice.state || null,
      postal_code: invoice.postal_code || null,
      country: invoice.country || null,
      tax_id: invoice.customer_tax_id || null,
    },
    items,
    tax_breakdown,
  };
}
