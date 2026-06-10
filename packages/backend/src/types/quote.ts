export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired" | "converted";

export interface Quote {
  id: string;
  quote_number: string;
  customer_id: string;
  status: QuoteStatus;
  issue_date: string;
  valid_until: string | null;
  subtotal: number;
  tax_total: number;
  discount_type: string | null;
  discount_value: number;
  discount_amount: number;
  total: number;
  notes: string | null;
  currency: string;
  share_token: string | null;
  is_published: number;
  converted_invoice_id: string | null;
  locale: string | null;
  template_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface QuoteItem {
  id: string;
  quote_id: string;
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

export interface QuoteWithItems extends Quote {
  items: QuoteItem[];
  customer?: {
    id: string;
    name: string;
    email: string | null;
  };
}
