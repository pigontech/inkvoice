export interface Settings {
  company_name: string;
  company_email: string;
  company_phone: string;
  company_address: string;
  company_tax_id: string;
  /** Multiline; rendered as HTML line breaks in PDF templates */
  company_bank_details?: string;
  company_logo: string;
  currency: string;
  tax_label: string;
  invoice_number_pattern: string;
  default_payment_terms: string;
  default_notes: string;
  locale: string;
  /** Month (1-12) the fiscal year starts; defaults to "1" (January). */
  fiscal_year_start_month?: string;
}

export interface TaxDefinition {
  id: string;
  name: string;
  rate: number;
  description: string | null;
  category_code: string;
  vendor_tax_id: string | null;
  is_default: number;
  is_active: number;
  created_at: string;
}

export interface Template {
  id: string;
  name: string;
  description: string | null;
  html_content: string;
  css_content: string | null;
  type: string;
  is_default: number;
  source_url: string | null;
  manifest_url: string | null;
  sha256_hash: string | null;
  file_size: number | null;
  installed_at: string | null;
  created_at: string;
  updated_at: string;
}
