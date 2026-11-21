import crypto from "node:crypto";
import { getDb } from "../database/connection";
import type { TaxDefinition } from "../types/settings";

/**
 * The VAT rate a document line is stored and totalled with. A new document
 * takes the rate of the line's tax definition, so it follows a changed rate;
 * an edit keeps the rate sent with the line ("line"). Either way a missing
 * value falls back to the other source.
 */
export function lineTaxRate(
  item: { tax_id?: string | null; tax_rate?: number | null },
  prefer: "definition" | "line",
): number {
  const sent = item.tax_rate ?? null;
  if (prefer === "line" && sent !== null) return sent;
  if (item.tax_id) {
    const def = getDb().query("SELECT rate FROM tax_definitions WHERE id = ?").get(item.tax_id) as {
      rate: number;
    } | null;
    if (def) return def.rate;
  }
  return sent ?? 0;
}

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
