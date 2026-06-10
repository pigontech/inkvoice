/** Structured invoice data DTO for XML generation */
export interface XmlInvoiceData {
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  currency: string;
  locale: string | null;
  type: "invoice" | "credit_note";
  notes: string | null;
  payment_terms: string | null;

  subtotal: number;
  tax_total: number;
  discount_amount: number;
  total: number;

  supplier: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    tax_id: string | null;
    country: string | null;
    bank_details: string | null;
    peppol_endpoint_id: string | null;
    peppol_scheme_id: string | null;
  };

  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    address_line1: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
    tax_id: string | null;
  };

  items: XmlLineItem[];
  tax_breakdown: XmlTaxBreakdown[];
}

export interface XmlLineItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  unit: string;
  line_total: number;
  tax_rate: number;
  tax_amount: number;
  tax_category_code: string;
}

export interface XmlTaxBreakdown {
  tax_name: string;
  tax_rate: number;
  category_code: string;
  taxable_amount: number;
  tax_amount: number;
}
