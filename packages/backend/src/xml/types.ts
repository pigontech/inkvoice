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

  /** EU VAT category for the whole document (overrides per-line when set). */
  document_category_code?: string;
  /** True when the seller is a German Kleinunternehmer (§ 19 UStG). */
  kleinunternehmer?: boolean;
  /** True when the seller is a French franchise en base (art. 293 B CGI). */
  franchise_fr?: boolean;
  /** True when the France network is enabled (drives FR-specific validation). */
  france_enabled?: boolean;

  supplier: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    street: string | null;
    city: string | null;
    postal_code: string | null;
    /** ISO 3166-1 alpha-2, e.g. "DE". */
    country: string | null;
    /** USt-IdNr (VAT id). */
    tax_id: string | null;
    /** German Steuernummer (tax number; not the USt-IdNr). */
    tax_number: string | null;
    bank_details: string | null;
    /** Structured payee account (validated in settings), preferred over bank_details. */
    iban: string | null;
    bic: string | null;
    account_holder: string | null;
    /** Seller contact point (BT-41); falls back to the company name. */
    contact_name: string | null;
    peppol_endpoint_id: string | null;
    peppol_scheme_id: string | null;
  };

  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
    tax_id: string | null;
    tax_number: string | null;
    einvoice_format: string | null;
    /** German Leitweg-ID for B2G (schemeID "0204"). */
    leitweg_id: string | null;
    einvoice_receiver_id: string | null;
    einvoice_receiver_scheme: string | null;
    /** French SIREN (9 digits) — buyer id schemeID "0009". */
    siren: string | null;
    /** French SIRET (14 digits) — buyer id schemeID "0002". */
    siret: string | null;
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
