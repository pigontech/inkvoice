export interface Expense {
  id: string;
  vendor: string | null;
  category: string | null;
  description: string | null;
  expense_date: string;
  amount: number;
  tax_id: string | null;
  tax_rate: number;
  tax_amount: number;
  total: number;
  currency: string;
  /** Base-currency units per 1 unit of `currency`, frozen at entry. 1 = same as base. */
  exchange_rate: number;
  receipt_reference: string | null;
  customer_id: string | null;
  is_billable: number;
  billed_invoice_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
