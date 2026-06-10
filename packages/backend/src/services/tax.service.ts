import crypto from "node:crypto";
import { getDb } from "../database/connection";
import type { TaxDefinition } from "../types/settings";

export function listTaxDefinitions(): TaxDefinition[] {
  const db = getDb();
  return db.query("SELECT * FROM tax_definitions ORDER BY name").all() as TaxDefinition[];
}

export function getTaxDefinition(id: string): TaxDefinition | null {
  const db = getDb();
  return db.query("SELECT * FROM tax_definitions WHERE id = ?").get(id) as TaxDefinition | null;
}

export function createTaxDefinition(data: Partial<TaxDefinition>): TaxDefinition {
  const db = getDb();
  const id = crypto.randomBytes(16).toString("hex");

  db.run(
    "INSERT INTO tax_definitions (id, name, rate, description, category_code, vendor_tax_id, is_default, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      data.name!,
      data.rate!,
      data.description || null,
      data.category_code || "S",
      data.vendor_tax_id || null,
      data.is_default ?? 0,
      data.is_active ?? 1,
    ],
  );

  return db.query("SELECT * FROM tax_definitions WHERE id = ?").get(id) as TaxDefinition;
}

export function updateTaxDefinition(
  id: string,
  data: Partial<TaxDefinition>,
): TaxDefinition | null {
  const db = getDb();
  const existing = db.query("SELECT id FROM tax_definitions WHERE id = ?").get(id);
  if (!existing) return null;

  db.run(
    "UPDATE tax_definitions SET name = ?, rate = ?, description = ?, category_code = ?, vendor_tax_id = ?, is_default = ?, is_active = ? WHERE id = ?",
    [
      data.name!,
      data.rate!,
      data.description || null,
      data.category_code || "S",
      data.vendor_tax_id || null,
      data.is_default ?? 0,
      data.is_active ?? 1,
      id,
    ],
  );

  return db.query("SELECT * FROM tax_definitions WHERE id = ?").get(id) as TaxDefinition;
}

export function deleteTaxDefinition(id: string): { success: boolean; error?: string } {
  const db = getDb();

  const usedInProducts = db
    .query("SELECT COUNT(*) as count FROM products WHERE tax_id = ?")
    .get(id) as { count: number };
  const usedInItems = db
    .query("SELECT COUNT(*) as count FROM invoice_items WHERE tax_id = ?")
    .get(id) as { count: number };

  if (usedInProducts.count > 0 || usedInItems.count > 0) {
    return { success: false, error: "Cannot delete tax definition that is in use" };
  }

  db.run("DELETE FROM tax_definitions WHERE id = ?", [id]);
  return { success: true };
}
