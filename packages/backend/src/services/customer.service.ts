import crypto from "node:crypto";
import { getDb } from "../database/connection";
import type { PaginatedResponse } from "../types/common";
import type { Customer } from "../types/customer";

interface CustomerListParams {
  search?: string;
  page: number;
  limit: number;
  /** ISO timestamp; returns only rows changed at/after it (integration polling). */
  updated_since?: string;
}

export function listCustomers(params: CustomerListParams): PaginatedResponse<Customer> {
  const db = getDb();
  const { search, page, limit, updated_since } = params;
  const offset = (page - 1) * limit;

  // Bare column names so the same clause works for both the aliased (c) item
  // query and the unaliased count query.
  const conditions: string[] = [];
  const queryParams: (string | number)[] = [];

  if (search) {
    conditions.push("(name LIKE ? OR email LIKE ?)");
    queryParams.push(`%${search}%`, `%${search}%`);
  }
  if (updated_since) {
    conditions.push("updated_at >= ?");
    queryParams.push(updated_since);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRow = db
    .query(`SELECT COUNT(*) as count FROM customers ${where}`)
    .get(...queryParams) as { count: number };
  const items = db
    .query(
      `SELECT c.*, COALESCE(ic.cnt, 0) AS invoice_count
     FROM customers c
     LEFT JOIN (SELECT customer_id, COUNT(*) as cnt FROM invoices WHERE deleted_at IS NULL GROUP BY customer_id) ic ON ic.customer_id = c.id
     ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...queryParams, limit, offset) as (Customer & { invoice_count: number })[];

  return {
    items,
    total: countRow.count,
    page,
    limit,
    totalPages: Math.ceil(countRow.count / limit),
  };
}

export function listCustomersForExport(params: { search?: string }): Customer[] {
  const db = getDb();
  let where = "";
  const queryParams: string[] = [];

  if (params.search) {
    where = "WHERE (name LIKE ? OR email LIKE ?)";
    queryParams.push(`%${params.search}%`, `%${params.search}%`);
  }

  return db
    .query(`SELECT * FROM customers ${where} ORDER BY created_at DESC`)
    .all(...queryParams) as Customer[];
}

export function getCustomer(id: string):
  | (Customer & {
      invoice_count: number;
      total_revenue: number;
      last_invoice_date: string | null;
      portal_token: string | null;
    })
  | null {
  const db = getDb();
  const customer = db.query("SELECT * FROM customers WHERE id = ?").get(id) as Customer | null;
  if (!customer) return null;

  const stats = db
    .query(`
    SELECT COUNT(*) as invoice_count, COALESCE(SUM(total), 0) as total_revenue,
           MAX(issue_date) as last_invoice_date
    FROM invoices WHERE customer_id = ?
  `)
    .get(id) as { invoice_count: number; total_revenue: number; last_invoice_date: string | null };

  const portal = db.query("SELECT token FROM portal_tokens WHERE customer_id = ?").get(id) as {
    token: string;
  } | null;

  return { ...customer, ...stats, portal_token: portal?.token ?? null };
}

export function createCustomer(data: Partial<Customer>): Customer {
  const db = getDb();
  const id = crypto.randomBytes(16).toString("hex");

  db.run(
    `INSERT INTO customers (id, name, email, phone, address_line1, address_line2, city, state, postal_code, country, tax_id, notes, language, default_template_id, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.name!,
      data.email || null,
      data.phone || null,
      data.address_line1 || null,
      data.address_line2 || null,
      data.city || null,
      data.state || null,
      data.postal_code || null,
      data.country || null,
      data.tax_id || null,
      data.notes || null,
      data.language || null,
      data.default_template_id || null,
      data.currency || null,
    ],
  );

  return db.query("SELECT * FROM customers WHERE id = ?").get(id) as Customer;
}

export function updateCustomer(id: string, data: Partial<Customer>): Customer | null {
  const db = getDb();
  const existing = db.query("SELECT id FROM customers WHERE id = ?").get(id);
  if (!existing) return null;

  db.run(
    `UPDATE customers SET name = ?, email = ?, phone = ?, address_line1 = ?, address_line2 = ?,
     city = ?, state = ?, postal_code = ?, country = ?, tax_id = ?, notes = ?, language = ?,
     default_template_id = ?, currency = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      data.name!,
      data.email || null,
      data.phone || null,
      data.address_line1 || null,
      data.address_line2 || null,
      data.city || null,
      data.state || null,
      data.postal_code || null,
      data.country || null,
      data.tax_id || null,
      data.notes || null,
      data.language || null,
      data.default_template_id || null,
      data.currency || null,
      id,
    ],
  );

  return db.query("SELECT * FROM customers WHERE id = ?").get(id) as Customer;
}

export function deleteCustomer(id: string): { success: boolean; error?: string } {
  const db = getDb();
  const invoiceCount = db
    .query("SELECT COUNT(*) as count FROM invoices WHERE customer_id = ? AND deleted_at IS NULL")
    .get(id) as { count: number };

  if (invoiceCount.count > 0) {
    return { success: false, error: "Cannot delete customer with existing invoices" };
  }

  db.run("DELETE FROM customers WHERE id = ?", [id]);
  return { success: true };
}

/**
 * Enable client portal access for a customer. Generates a fresh token if one
 * doesn't exist, sets `portal_enabled = 1`, and returns the token. Idempotent —
 * calling twice keeps the same token.
 */
export function enableCustomerPortal(id: string): { token: string } | null {
  const db = getDb();
  const existing = db.query("SELECT id FROM customers WHERE id = ?").get(id);
  if (!existing) return null;

  db.run("UPDATE customers SET portal_enabled = 1, updated_at = datetime('now') WHERE id = ?", [
    id,
  ]);

  const existingToken = db
    .query("SELECT token FROM portal_tokens WHERE customer_id = ?")
    .get(id) as { token: string } | null;
  if (existingToken) return { token: existingToken.token };

  const token = crypto.randomBytes(24).toString("hex");
  db.run("INSERT INTO portal_tokens (id, customer_id, token) VALUES (?, ?, ?)", [
    crypto.randomBytes(16).toString("hex"),
    id,
    token,
  ]);
  return { token };
}

/**
 * Disable portal access. Flips the flag and rotates the token by deleting it,
 * so re-enabling later issues a fresh URL (existing bookmarks become invalid).
 */
export function disableCustomerPortal(id: string): boolean {
  const db = getDb();
  const existing = db.query("SELECT id FROM customers WHERE id = ?").get(id);
  if (!existing) return false;
  db.run("UPDATE customers SET portal_enabled = 0, updated_at = datetime('now') WHERE id = ?", [
    id,
  ]);
  db.run("DELETE FROM portal_tokens WHERE customer_id = ?", [id]);
  return true;
}

export function getCustomerPortalToken(id: string): string | null {
  const db = getDb();
  const row = db.query("SELECT token FROM portal_tokens WHERE customer_id = ?").get(id) as {
    token: string;
  } | null;
  return row?.token ?? null;
}
