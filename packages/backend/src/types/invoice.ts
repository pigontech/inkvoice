export type InvoiceType = "invoice" | "credit_note";

export interface Invoice {
  id: string;
  invoice_number: string;
  customer_id: string;
  status: InvoiceStatus;
  type: InvoiceType;
  reference_invoice_id: string | null;
  issue_date: string;
  due_date: string | null;
  subtotal: number;
  tax_total: number;
  discount_type: string | null;
  discount_value: number;
  discount_amount: number;
  total: number;
  amount_paid: number;
  notes: string | null;
  payment_terms: string | null;
  currency: string;
  /** Base-currency units per 1 unit of `currency`, frozen at issue. 1 = same as base. */
  exchange_rate: number;
  prices_include_tax: number;
  share_token: string | null;
  /** First/most-recent time a client opened the public share link. */
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  is_published: number;
  locale: string | null;
  template_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "paid"
  | "partially_paid"
  | "overdue"
  | "voided"
  | "complete";

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  product_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  unit: string;
  tax_id: string | null;
  tax_rate: number;
  tax_amount: number;
  line_total: number;
  sort_order: number;
  created_at: string;
}

export interface InvoiceWithItems extends Invoice {
  items: InvoiceItem[];
  customer?: {
    id: string;
    name: string;
    email: string | null;
  };
}
