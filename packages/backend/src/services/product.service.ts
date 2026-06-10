import crypto from "node:crypto";
import { getDb } from "../database/connection";
import type { PaginatedResponse } from "../types/common";
import type { Product } from "../types/product";

interface ProductListParams {
  category?: string;
  active?: string;
  search?: string;
  page: number;
  limit: number;
}

export function listProducts(params: ProductListParams): PaginatedResponse<Product> {
  const db = getDb();
  const { category, active, search, page, limit } = params;
  const offset = (page - 1) * limit;
  const conditions: string[] = [];
  const queryParams: (string | number)[] = [];

  if (category) {
    conditions.push("category = ?");
    queryParams.push(category);
  }
  if (active !== undefined) {
    conditions.push("is_active = ?");
    queryParams.push(active === "true" ? 1 : 0);
  }
  if (search) {
    conditions.push("(name LIKE ? OR sku LIKE ?)");
    queryParams.push(`%${search}%`, `%${search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = db
    .query(`SELECT COUNT(*) as count FROM products ${where}`)
    .get(...queryParams) as { count: number };
  const items = db
    .query(`SELECT * FROM products ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...queryParams, limit, offset) as Product[];

  return {
    items,
    total: countRow.count,
    page,
    limit,
    totalPages: Math.ceil(countRow.count / limit),
  };
}

interface ProductExportRow extends Product {
  tax_name: string | null;
  tax_rate: number | null;
}

export function listProductsForExport(params: {
  category?: string;
  active?: string;
  search?: string;
}): ProductExportRow[] {
  const db = getDb();
  const conditions: string[] = [];
  const queryParams: (string | number)[] = [];

  if (params.category) {
    conditions.push("p.category = ?");
    queryParams.push(params.category);
  }
  if (params.active !== undefined) {
    conditions.push("p.is_active = ?");
    queryParams.push(params.active === "true" ? 1 : 0);
  }
  if (params.search) {
    conditions.push("(p.name LIKE ? OR p.sku LIKE ?)");
    queryParams.push(`%${params.search}%`, `%${params.search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  return db
    .query(
      `SELECT p.*, t.name as tax_name, t.rate as tax_rate
       FROM products p LEFT JOIN tax_definitions t ON p.tax_id = t.id
       ${where} ORDER BY p.created_at DESC`,
    )
    .all(...queryParams) as ProductExportRow[];
}

export function getProduct(id: string): Product | null {
  const db = getDb();
  return db.query("SELECT * FROM products WHERE id = ?").get(id) as Product | null;
}

export function createProduct(data: Partial<Product>): Product {
  const db = getDb();
  const id = crypto.randomBytes(16).toString("hex");

  db.run(
    `INSERT INTO products (id, name, description, sku, unit_price, unit, category, tax_id, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.name!,
      data.description || null,
      data.sku || null,
      data.unit_price ?? 0,
      data.unit || "piece",
      data.category || "service",
      data.tax_id || null,
      data.is_active ?? 1,
    ],
  );

  return db.query("SELECT * FROM products WHERE id = ?").get(id) as Product;
}

export function updateProduct(id: string, data: Partial<Product>): Product | null {
  const db = getDb();
  const existing = db.query("SELECT id FROM products WHERE id = ?").get(id);
  if (!existing) return null;

  db.run(
    `UPDATE products SET name = ?, description = ?, sku = ?, unit_price = ?, unit = ?,
     category = ?, tax_id = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`,
    [
      data.name!,
      data.description || null,
      data.sku || null,
      data.unit_price ?? 0,
      data.unit || "piece",
      data.category || "service",
      data.tax_id || null,
      data.is_active ?? 1,
      id,
    ],
  );

  return db.query("SELECT * FROM products WHERE id = ?").get(id) as Product;
}

export function deleteProduct(id: string): { success: boolean; error?: string } {
  const db = getDb();
  const usedInInvoices = db
    .query("SELECT COUNT(*) as count FROM invoice_items WHERE product_id = ?")
    .get(id) as { count: number };

  if (usedInInvoices.count > 0) {
    // Soft delete
    db.run("UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?", [id]);
    return { success: true };
  }

  db.run("DELETE FROM products WHERE id = ?", [id]);
  return { success: true };
}

export function reactivateProduct(id: string): { success: boolean; error?: string } {
  const db = getDb();
  const existing = db.query("SELECT id, is_active FROM products WHERE id = ?").get(id) as {
    id: string;
    is_active: number;
  } | null;

  if (!existing) {
    return { success: false, error: "Product not found" };
  }
  if (existing.is_active === 1) {
    return { success: false, error: "Product is already active" };
  }

  db.run("UPDATE products SET is_active = 1, updated_at = datetime('now') WHERE id = ?", [id]);
  return { success: true };
}

export function getProductUsage(id: string): {
  invoice_count: number;
  quote_count: number;
} | null {
  const db = getDb();
  const existing = db.query("SELECT id FROM products WHERE id = ?").get(id);
  if (!existing) return null;

  const invoiceRow = db
    .query("SELECT COUNT(*) as count FROM invoice_items WHERE product_id = ?")
    .get(id) as { count: number };

  const quoteRow = db
    .query("SELECT COUNT(*) as count FROM quote_items WHERE product_id = ?")
    .get(id) as { count: number };

  return {
    invoice_count: invoiceRow.count,
    quote_count: quoteRow.count,
  };
}
