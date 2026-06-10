import crypto from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../database/connection";
import { logActivity } from "../services/activity.service";
import * as productService from "../services/product.service";
import { buildCsv, type CsvColumn, csvHeaders } from "../utils/csv";
import { parseCsv } from "../utils/csv-parser";
import { todayIso } from "../utils/date";

const products = new Hono();

products.get("/", (c) => {
  const category = c.req.query("category");
  const active = c.req.query("active");
  const search = c.req.query("search");
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") || "20", 10) || 20), 100);

  const data = productService.listProducts({ category, active, search, page, limit });
  return c.json({ success: true, data });
});

// CSV export — before parameterized routes
type ProductExportRow = Awaited<ReturnType<typeof productService.listProductsForExport>>[number];

const productCsvColumns: CsvColumn<ProductExportRow>[] = [
  { header: "Name", key: "name" },
  { header: "Description", key: "description" },
  { header: "SKU", key: "sku" },
  { header: "Unit Price", key: "unit_price" },
  { header: "Unit", key: "unit" },
  { header: "Category", key: "category" },
  { header: "Tax Name", key: "tax_name" },
  { header: "Tax Rate", key: "tax_rate" },
  { header: "Active", key: "is_active", formatter: (v) => (v === 1 ? "Yes" : "No") },
  { header: "Created", key: "created_at" },
];

products.get("/export/csv", (c) => {
  const rows = productService.listProductsForExport({
    category: c.req.query("category"),
    active: c.req.query("active"),
    search: c.req.query("search"),
  });

  const headers = csvHeaders(`products-${todayIso()}.csv`);
  for (const [k, v] of Object.entries(headers)) c.header(k, v);
  return c.body(buildCsv(rows, productCsvColumns));
});

// CSV import (mirror of /customers/import — see comment there for the flow)
const PRODUCT_FIELDS = ["name", "description", "sku", "unit_price", "unit", "category"] as const;
type ProductField = (typeof PRODUCT_FIELDS)[number];

const productImportSchema = z.object({
  csv: z.string().min(1).max(5_000_000),
  mapping: z.record(z.string(), z.enum(PRODUCT_FIELDS)),
  dry_run: z.boolean().default(false),
});

products.post("/import/preview", async (c) => {
  const body = await c.req.parseBody();
  const file = body.csv;
  if (!file || !(file instanceof File)) {
    return c.json({ success: false, error: "No CSV file provided" }, 400);
  }
  if (file.size > 5_000_000) {
    return c.json({ success: false, error: "CSV file too large (max 5MB)" }, 400);
  }
  const text = await file.text();
  const parsed = parseCsv(text);
  if (parsed.headers.length === 0) {
    return c.json({ success: false, error: "CSV has no header row" }, 400);
  }

  const suggested: Record<string, ProductField> = {};
  parsed.headers.forEach((h, i) => {
    const norm = h.toLowerCase().trim().replace(/\s+/g, "_");
    for (const f of PRODUCT_FIELDS) {
      if (norm === f || norm === f.replace("_", "")) {
        suggested[String(i)] = f;
        break;
      }
    }
    if (!suggested[String(i)]) {
      if (norm === "price" || norm === "rate") suggested[String(i)] = "unit_price";
      else if (norm === "title" || norm === "product_name") suggested[String(i)] = "name";
    }
  });

  return c.json({
    success: true,
    data: {
      headers: parsed.headers,
      sample_rows: parsed.rows.slice(0, 5),
      total_rows: parsed.rows.length,
      suggested_mapping: suggested,
      available_fields: PRODUCT_FIELDS,
    },
  });
});

products.post("/import", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = productImportSchema.parse(body);
  const csv = parseCsv(parsed.csv);
  if (csv.headers.length === 0) {
    return c.json({ success: false, error: "CSV is empty" }, 400);
  }

  const mappingByIndex: (ProductField | null)[] = csv.headers.map((_, i) => {
    return parsed.mapping[String(i)] ?? null;
  });

  if (!mappingByIndex.includes("name")) {
    return c.json({ success: false, error: "Mapping must include the 'name' field" }, 400);
  }

  const errors: { row: number; reason: string }[] = [];
  const validRows: Record<string, string | number>[] = [];

  csv.rows.forEach((row, idx) => {
    const product: Record<string, string | number> = {};
    mappingByIndex.forEach((field, colIdx) => {
      if (!field) return;
      const value = (row[colIdx] ?? "").trim();
      if (!value) return;
      if (field === "unit_price") {
        const n = parseFloat(value.replace(/[,]/g, ""));
        if (Number.isFinite(n)) product[field] = n;
      } else {
        product[field] = value;
      }
    });

    if (!product.name) {
      errors.push({ row: idx + 2, reason: "Missing required field 'name'" });
      return;
    }
    if (product.unit_price !== undefined && (product.unit_price as number) < 0) {
      errors.push({ row: idx + 2, reason: "unit_price must be >= 0" });
      return;
    }
    validRows.push(product);
  });

  if (parsed.dry_run) {
    return c.json({
      success: true,
      data: {
        dry_run: true,
        would_create: validRows.length,
        errors,
        first_preview: validRows.slice(0, 3),
      },
    });
  }

  let created = 0;
  for (const data of validRows) {
    try {
      productService.createProduct(data);
      created++;
    } catch (err) {
      errors.push({
        row: validRows.indexOf(data) + 2,
        reason: err instanceof Error ? err.message : "Insert failed",
      });
    }
  }

  return c.json({
    success: true,
    data: { created, failed: errors.length, errors },
  });
});

// --- Product Categories ---
products.get("/categories", (c) => {
  const db = getDb();
  const rows = db
    .query("SELECT * FROM product_categories ORDER BY is_builtin DESC, name ASC")
    .all();
  return c.json({ success: true, data: rows });
});

products.post("/categories", async (c) => {
  const body = await c.req.json();
  const parsed = z.object({ name: z.string().min(1).max(100) }).parse(body);
  const db = getDb();
  const id = crypto.randomBytes(16).toString("hex");
  db.run("INSERT INTO product_categories (id, name, is_builtin) VALUES (?, ?, 0)", [
    id,
    parsed.name,
  ]);
  const created = db.query("SELECT * FROM product_categories WHERE id = ?").get(id);
  return c.json({ success: true, data: created }, 201);
});

products.put("/categories/:id", async (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const row = db.query("SELECT * FROM product_categories WHERE id = ?").get(id) as {
    name: string;
  } | null;
  if (!row) return c.json({ success: false, error: "Category not found" }, 404);
  const body = await c.req.json();
  const parsed = z.object({ name: z.string().min(1).max(100) }).parse(body);
  if (parsed.name !== row.name) {
    const existing = db
      .query("SELECT id FROM product_categories WHERE name = ? AND id != ?")
      .get(parsed.name, id);
    if (existing) return c.json({ success: false, error: "Category name already exists" }, 409);
    db.exec("BEGIN");
    try {
      db.run("UPDATE product_categories SET name = ? WHERE id = ?", [parsed.name, id]);
      db.run("UPDATE products SET category = ? WHERE category = ?", [parsed.name, row.name]);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  const updated = db.query("SELECT * FROM product_categories WHERE id = ?").get(id);
  return c.json({ success: true, data: updated });
});

products.delete("/categories/:id", (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const row = db.query("SELECT * FROM product_categories WHERE id = ?").get(id) as {
    is_builtin: number;
    name: string;
  } | null;
  if (!row) return c.json({ success: false, error: "Category not found" }, 404);
  if (row.is_builtin)
    return c.json({ success: false, error: "Cannot delete built-in category" }, 409);
  const usage = db
    .query("SELECT COUNT(*) as count FROM products WHERE category = ?")
    .get(row.name) as { count: number };
  if (usage.count > 0)
    return c.json({ success: false, error: "Category is in use by products" }, 409);
  db.run("DELETE FROM product_categories WHERE id = ?", [id]);
  return c.json({ success: true });
});

// --- Product Units ---
products.get("/units", (c) => {
  const db = getDb();
  const rows = db.query("SELECT * FROM product_units ORDER BY is_builtin DESC, name ASC").all();
  return c.json({ success: true, data: rows });
});

products.post("/units", async (c) => {
  const body = await c.req.json();
  const parsed = z
    .object({ name: z.string().min(1).max(100), symbol: z.string().max(10).optional() })
    .parse(body);
  const db = getDb();
  const id = crypto.randomBytes(16).toString("hex");
  db.run("INSERT INTO product_units (id, name, symbol, is_builtin) VALUES (?, ?, ?, 0)", [
    id,
    parsed.name,
    parsed.symbol || null,
  ]);
  const created = db.query("SELECT * FROM product_units WHERE id = ?").get(id);
  return c.json({ success: true, data: created }, 201);
});

products.put("/units/:id", async (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const row = db.query("SELECT * FROM product_units WHERE id = ?").get(id) as {
    name: string;
  } | null;
  if (!row) return c.json({ success: false, error: "Unit not found" }, 404);
  const body = await c.req.json();
  const parsed = z
    .object({ name: z.string().min(1).max(100), symbol: z.string().max(10).optional() })
    .parse(body);
  if (parsed.name !== row.name) {
    const existing = db
      .query("SELECT id FROM product_units WHERE name = ? AND id != ?")
      .get(parsed.name, id);
    if (existing) return c.json({ success: false, error: "Unit name already exists" }, 409);
    db.exec("BEGIN");
    try {
      db.run("UPDATE product_units SET name = ?, symbol = ? WHERE id = ?", [
        parsed.name,
        parsed.symbol ?? null,
        id,
      ]);
      db.run("UPDATE products SET unit = ? WHERE unit = ?", [parsed.name, row.name]);
      db.run("UPDATE invoice_items SET unit = ? WHERE unit = ?", [parsed.name, row.name]);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } else {
    db.run("UPDATE product_units SET symbol = ? WHERE id = ?", [parsed.symbol ?? null, id]);
  }
  const updated = db.query("SELECT * FROM product_units WHERE id = ?").get(id);
  return c.json({ success: true, data: updated });
});

products.delete("/units/:id", (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const row = db.query("SELECT * FROM product_units WHERE id = ?").get(id) as {
    is_builtin: number;
    name: string;
  } | null;
  if (!row) return c.json({ success: false, error: "Unit not found" }, 404);
  if (row.is_builtin) return c.json({ success: false, error: "Cannot delete built-in unit" }, 409);
  const usage = db.query("SELECT COUNT(*) as count FROM products WHERE unit = ?").get(row.name) as {
    count: number;
  };
  if (usage.count > 0) return c.json({ success: false, error: "Unit is in use by products" }, 409);
  db.run("DELETE FROM product_units WHERE id = ?", [id]);
  return c.json({ success: true });
});

products.get("/:id", (c) => {
  const product = productService.getProduct(c.req.param("id"));
  if (!product) {
    return c.json({ success: false, error: "Product not found" }, 404);
  }
  return c.json({ success: true, data: product });
});

const productSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional().or(z.literal("")),
  sku: z.string().max(50).optional().or(z.literal("")),
  unit_price: z.number().min(0),
  unit: z.string().max(20).optional(),
  category: z.string().max(100).optional(),
  tax_id: z.string().optional().nullable(),
  is_active: z.number().min(0).max(1).optional(),
});

products.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = productSchema.parse(body);
  const product = productService.createProduct(parsed);
  logActivity({
    user_id: c.get("userId"),
    user_name: c.get("user")?.username,
    action: "created",
    resource_type: "product",
    resource_id: product.id,
    metadata: { product_name: product.name },
  });
  return c.json({ success: true, data: product }, 201);
});

products.put("/:id", async (c) => {
  const body = await c.req.json();
  const parsed = productSchema.parse(body);
  const product = productService.updateProduct(c.req.param("id"), parsed);
  if (!product) {
    return c.json({ success: false, error: "Product not found" }, 404);
  }
  logActivity({
    user_id: c.get("userId"),
    user_name: c.get("user")?.username,
    action: "updated",
    resource_type: "product",
    resource_id: product.id,
    metadata: { product_name: product.name },
  });
  return c.json({ success: true, data: product });
});

products.post("/:id/reactivate", (c) => {
  const result = productService.reactivateProduct(c.req.param("id"));
  if (!result.success) {
    const status = result.error === "Product not found" ? 404 : 409;
    return c.json({ success: false, error: result.error }, status);
  }
  return c.json({ success: true });
});

products.get("/:id/usage", (c) => {
  const usage = productService.getProductUsage(c.req.param("id"));
  if (!usage) {
    return c.json({ success: false, error: "Product not found" }, 404);
  }
  return c.json({ success: true, data: usage });
});

products.delete("/:id", (c) => {
  const id = c.req.param("id");
  const product = productService.getProduct(id);
  const result = productService.deleteProduct(id);
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 409);
  }
  logActivity({
    user_id: c.get("userId"),
    user_name: c.get("user")?.username,
    action: "deleted",
    resource_type: "product",
    resource_id: id,
    metadata: product ? { product_name: product.name } : undefined,
  });
  return c.json({ success: true });
});

const batchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  action: z.enum(["delete"]),
});

products.post("/batch", async (c) => {
  const body = await c.req.json();
  const parsed = batchSchema.parse(body);
  const errors: { id: string; reason: string }[] = [];
  let succeeded = 0;

  for (const id of parsed.ids) {
    const result = productService.deleteProduct(id);
    if (result.success) {
      succeeded++;
    } else {
      errors.push({ id, reason: result.error || "Cannot delete" });
    }
  }

  return c.json({ success: true, data: { succeeded, failed: errors.length, errors } });
});

export { products };
