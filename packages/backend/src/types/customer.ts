export interface Customer {
  id: string;
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
  notes: string | null;
  /** BCP 47 tag (e.g. "en-US", "tr-TR"); when set, PDFs render in this locale. */
  language: string | null;
  /** Optional template override; used when an invoice/quote has no template_id set. */
  default_template_id: string | null;
  /** Default currency for this customer's invoices (null = business currency). */
  currency: string | null;
  /** When true, the customer can view their invoices via a per-customer portal URL. */
  portal_enabled: number;
  created_at: string;
  updated_at: string;
}
