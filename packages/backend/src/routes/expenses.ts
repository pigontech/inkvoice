import { Hono } from "hono";
import { z } from "zod";
import { requirePermission } from "../middleware/auth";
import { logActivity } from "../services/activity.service";
import * as expenseService from "../services/expense.service";
import { getAllSettings } from "../services/settings.service";
import { buildCsv, type CsvColumn, csvHeaders } from "../utils/csv";
import { parseCsv } from "../utils/csv-parser";
import { todayIso } from "../utils/date";
import { regionalColumns } from "../utils/region-terms";

const expenses = new Hono();

expenses.get("/", requirePermission("expenses", "read"), (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") || "20", 10) || 20), 100);

  const data = expenseService.listExpenses({
    category: c.req.query("category"),
    billable: c.req.query("billable"),
    customer_id: c.req.query("customer_id"),
    search: c.req.query("search"),
    date_from: c.req.query("date_from"),
    date_to: c.req.query("date_to"),
    page,
    limit,
  });
  return c.json({ success: true, data });
});

// CSV export — before parameterized routes
type ExpenseExportRow = ReturnType<typeof expenseService.listExpensesForExport>[number];

const expenseCsvColumns: CsvColumn<ExpenseExportRow>[] = [
  { header: "Date", key: "expense_date" },
  { header: "Vendor", key: "vendor" },
  { header: "Category", key: "category" },
  { header: "Description", key: "description" },
  { header: "Amount", key: "amount" },
  { header: "Tax", key: "tax_amount" },
  { header: "Total", key: "total" },
  { header: "Currency", key: "currency" },
  { header: "Customer", key: "customer_name" },
  { header: "Billable", key: "is_billable", formatter: (v) => (v === 1 ? "Yes" : "No") },
  { header: "Receipt", key: "receipt_reference" },
];

expenses.get("/export/csv", requirePermission("expenses", "export"), (c) => {
  const rows = expenseService.listExpensesForExport({
    category: c.req.query("category"),
    billable: c.req.query("billable"),
    customer_id: c.req.query("customer_id"),
    search: c.req.query("search"),
    date_from: c.req.query("date_from"),
    date_to: c.req.query("date_to"),
  });

  const headers = csvHeaders(`expenses-${todayIso()}.csv`);
  for (const [k, v] of Object.entries(headers)) c.header(k, v);
  return c.body(buildCsv(rows, regionalColumns(expenseCsvColumns, getAllSettings())));
});

// CSV import (mirror of /products/import)
const EXPENSE_FIELDS = ["vendor", "category", "description", "expense_date", "amount"] as const;
type ExpenseField = (typeof EXPENSE_FIELDS)[number];

const expenseImportSchema = z.object({
  csv: z.string().min(1).max(5_000_000),
  mapping: z.record(z.string(), z.enum(EXPENSE_FIELDS)),
  dry_run: z.boolean().default(false),
});

expenses.post("/import/preview", requirePermission("expenses", "create"), async (c) => {
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

  const suggested: Record<string, ExpenseField> = {};
  parsed.headers.forEach((h, i) => {
    const norm = h.toLowerCase().trim().replace(/\s+/g, "_");
    for (const f of EXPENSE_FIELDS) {
      if (norm === f || norm === f.replace("_", "")) {
        suggested[String(i)] = f;
        break;
      }
    }
    if (!suggested[String(i)]) {
      if (norm === "supplier" || norm === "payee") suggested[String(i)] = "vendor";
      else if (norm === "date") suggested[String(i)] = "expense_date";
      else if (norm === "amount" || norm === "cost" || norm === "price")
        suggested[String(i)] = "amount";
    }
  });

  return c.json({
    success: true,
    data: {
      headers: parsed.headers,
      sample_rows: parsed.rows.slice(0, 5),
      total_rows: parsed.rows.length,
      suggested_mapping: suggested,
      available_fields: EXPENSE_FIELDS,
    },
  });
});

expenses.post("/import", requirePermission("expenses", "create"), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = expenseImportSchema.parse(body);
  const csv = parseCsv(parsed.csv);
  if (csv.headers.length === 0) {
    return c.json({ success: false, error: "CSV is empty" }, 400);
  }

  const mappingByIndex: (ExpenseField | null)[] = csv.headers.map((_, i) => {
    return parsed.mapping[String(i)] ?? null;
  });

  if (!mappingByIndex.includes("amount")) {
    return c.json({ success: false, error: "Mapping must include the 'amount' field" }, 400);
  }

  const errors: { row: number; reason: string }[] = [];
  const validRows: Record<string, string | number>[] = [];

  csv.rows.forEach((row, idx) => {
    const expense: Record<string, string | number> = {};
    mappingByIndex.forEach((field, colIdx) => {
      if (!field) return;
      const value = (row[colIdx] ?? "").trim();
      if (!value) return;
      if (field === "amount") {
        const n = parseFloat(value.replace(/[,]/g, ""));
        if (Number.isFinite(n)) expense[field] = n;
      } else {
        expense[field] = value;
      }
    });

    if (expense.amount === undefined) {
      errors.push({ row: idx + 2, reason: "Missing or invalid 'amount'" });
      return;
    }
    if ((expense.amount as number) < 0) {
      errors.push({ row: idx + 2, reason: "amount must be >= 0" });
      return;
    }
    validRows.push(expense);
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
      expenseService.createExpense(data);
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

expenses.get("/:id", requirePermission("expenses", "read"), (c) => {
  const expense = expenseService.getExpense(c.req.param("id"));
  if (!expense) {
    return c.json({ success: false, error: "Expense not found" }, 404);
  }
  return c.json({ success: true, data: expense });
});

const expenseSchema = z.object({
  vendor: z.string().max(255).optional().or(z.literal("")),
  category: z.string().max(100).optional().or(z.literal("")),
  description: z.string().max(1000).optional().or(z.literal("")),
  expense_date: z.string().min(1),
  amount: z.number().min(0),
  tax_id: z.string().optional().nullable(),
  currency: z.string().max(3).optional(),
  exchange_rate: z.number().positive().optional(),
  receipt_reference: z.string().max(500).optional().or(z.literal("")),
  customer_id: z.string().optional().nullable(),
  is_billable: z.number().min(0).max(1).optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

expenses.post("/", requirePermission("expenses", "create"), async (c) => {
  const body = await c.req.json();
  const parsed = expenseSchema.parse(body);
  const expense = expenseService.createExpense(parsed);
  logActivity({
    user_id: c.get("userId"),
    user_name: c.get("user")?.username,
    action: "created",
    resource_type: "expense",
    resource_id: expense.id,
    metadata: { vendor: expense.vendor, amount: expense.total },
  });
  return c.json({ success: true, data: expense }, 201);
});

expenses.put("/:id", requirePermission("expenses", "update"), async (c) => {
  const body = await c.req.json();
  const parsed = expenseSchema.parse(body);
  const expense = expenseService.updateExpense(c.req.param("id"), parsed);
  if (!expense) {
    return c.json({ success: false, error: "Expense not found" }, 404);
  }
  logActivity({
    user_id: c.get("userId"),
    user_name: c.get("user")?.username,
    action: "updated",
    resource_type: "expense",
    resource_id: expense.id,
    metadata: { vendor: expense.vendor, amount: expense.total },
  });
  return c.json({ success: true, data: expense });
});

// Rebilling writes an invoice, so it needs that permission too.
expenses.post(
  "/:id/rebill",
  requirePermission("expenses", "update"),
  requirePermission("invoices", "create"),
  (c) => {
    const result = expenseService.rebillExpense(c.req.param("id"));
    if (!result.success) {
      const status = result.error === "Expense not found" ? 404 : 409;
      return c.json({ success: false, error: result.error }, status);
    }
    logActivity({
      user_id: c.get("userId"),
      user_name: c.get("user")?.username,
      action: "rebilled",
      resource_type: "expense",
      resource_id: c.req.param("id"),
      metadata: { invoice_id: result.invoice_id },
    });
    return c.json({ success: true, data: { invoice_id: result.invoice_id } });
  },
);

// --- Receipt file (photo or PDF) attached to an expense ---------------------

// Upload or replace. multipart/form-data with the file in a `file` field
// (`receipt` is accepted too). The type is detected from the bytes, so a phone
// that labels a HEIC photo application/octet-stream still works.
expenses.post("/:id/receipt", requirePermission("expenses", "update"), async (c) => {
  const id = c.req.param("id");
  if (!expenseService.getExpense(id)) {
    return c.json({ success: false, error: "Expense not found" }, 404);
  }
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ success: false, error: "Expected a multipart/form-data upload" }, 400);
  }
  const file = body.file ?? body.receipt;
  if (!file || !(file instanceof File)) {
    return c.json({ success: false, error: "No file provided (multipart field 'file')" }, 400);
  }
  if (file.size > expenseService.MAX_RECEIPT_BYTES) {
    return c.json({ success: false, error: "Receipt must be 10 MB or smaller" }, 413);
  }
  const result = expenseService.saveExpenseReceipt(id, {
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  if (!result.success) {
    return c.json({ success: false, error: result.error }, result.status);
  }
  logActivity({
    user_id: c.get("userId"),
    user_name: c.get("user")?.username,
    action: "updated",
    resource_type: "expense",
    resource_id: id,
    metadata: { receipt: result.data.file_name, size: result.data.size },
  });
  return c.json({ success: true, data: expenseService.getExpense(id) }, 201);
});

// Download the stored file. Inline by default (for an <img> or a PDF viewer);
// `?download=1` asks the browser to save it instead.
expenses.get("/:id/receipt", requirePermission("expenses", "read"), (c) => {
  const receipt = expenseService.getExpenseReceipt(c.req.param("id"));
  if (!receipt) return c.json({ success: false, error: "Receipt not found" }, 404);
  const disposition = c.req.query("download") ? "attachment" : "inline";
  const asciiName = receipt.file_name.replace(/[^\x20-\x7e]/g, "_");
  // c.header (not c.body's header argument) so these replace the app-wide
  // CSP the security middleware already set.
  c.header("Content-Type", receipt.content_type);
  c.header("Content-Length", String(receipt.size));
  c.header(
    "Content-Disposition",
    `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(receipt.file_name)}`,
  );
  c.header("Content-Security-Policy", "default-src 'none'; sandbox");
  c.header("Cache-Control", "private, no-store");
  return c.body(receipt.content);
});

expenses.delete("/:id/receipt", requirePermission("expenses", "update"), (c) => {
  const id = c.req.param("id");
  if (!expenseService.getExpense(id)) {
    return c.json({ success: false, error: "Expense not found" }, 404);
  }
  if (!expenseService.deleteExpenseReceipt(id)) {
    return c.json({ success: false, error: "Receipt not found" }, 404);
  }
  logActivity({
    user_id: c.get("userId"),
    user_name: c.get("user")?.username,
    action: "updated",
    resource_type: "expense",
    resource_id: id,
    metadata: { receipt: null },
  });
  return c.json({ success: true, data: expenseService.getExpense(id) });
});

expenses.delete("/:id", requirePermission("expenses", "delete"), (c) => {
  const id = c.req.param("id");
  const expense = expenseService.getExpense(id);
  const result = expenseService.deleteExpense(id);
  if (!result.success) {
    const status = result.error === "Expense not found" ? 404 : 409;
    return c.json({ success: false, error: result.error }, status);
  }
  logActivity({
    user_id: c.get("userId"),
    user_name: c.get("user")?.username,
    action: "deleted",
    resource_type: "expense",
    resource_id: id,
    metadata: expense ? { vendor: expense.vendor } : undefined,
  });
  return c.json({ success: true });
});

const batchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  action: z.enum(["delete"]),
});

expenses.post("/batch", requirePermission("expenses", "delete"), async (c) => {
  const body = await c.req.json();
  const parsed = batchSchema.parse(body);
  const errors: { id: string; reason: string }[] = [];
  let succeeded = 0;

  for (const id of parsed.ids) {
    const result = expenseService.deleteExpense(id);
    if (result.success) {
      succeeded++;
    } else {
      errors.push({ id, reason: result.error || "Cannot delete" });
    }
  }

  return c.json({ success: true, data: { succeeded, failed: errors.length, errors } });
});

export { expenses };
