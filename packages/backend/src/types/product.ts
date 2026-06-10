export interface Product {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  unit_price: number;
  unit: string;
  category: string;
  tax_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}
