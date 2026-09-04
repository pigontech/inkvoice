import { Hono } from "hono";
import { z } from "zod";
import { logActivity } from "../services/activity.service";
import * as customerService from "../services/customer.service";
import { deleteMethod, listMethodsForCustomer } from "../services/customer-payment-method.service";
import { buildStatementData, renderStatementHtml } from "../services/statement.service";
import { getTagsForItem, setItemTags } from "../services/tag.service";
import type { Customer } from "../types/customer";
import { buildCsv, type CsvColumn, csvHeaders } from "../utils/csv";
import { parseCsv } from "../utils/csv-parser";
import { todayIso } from "../utils/date";

const customers = new Hono();

/**
 * Resolve a statement date range from optional `from`/`to` (YYYY-MM-DD).
 * Defaults to year-to-date: `to` = today, `from` = Jan 1 of that year.
 */
function statementRange(from?: string, to?: string): { from: string; to: string } {
  const isDate = (s?: string): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const toDate = isDate(to) ? to : todayIso();
  const fromDate = isDate(from) ? from : `${toDate.slice(0, 4)}-01-01`;
  return { from: fromDate, to: toDate };
}

customers.get("/", (c) => {
  const search = c.req.query("search");
  const updated_since = c.req.query("updated_since");
  const tags = c.req.query("tags");
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") || "20", 10) || 20), 100);

  const data = customerService.listCustomers({ search, updated_since, tags, page, limit });
  return c.json({ success: true, data });
});

// CSV export — before parameterized routes
const customerCsvColumns: CsvColumn<Customer>[] = [
  { header: "Name", key: "name" },
  { header: "Email", key: "email" },
  { header: "Phone", key: "phone" },
  { header: "Address Line 1", key: "address_line1" },
  { header: "Address Line 2", key: "address_line2" },
  { header: "City", key: "city" },
  { header: "State", key: "state" },
  { header: "Postal Code", key: "postal_code" },
  { header: "Country", key: "country" },
  { header: "Tax ID", key: "tax_id" },
  { header: "Notes", key: "notes" },
  { header: "Created", key: "created_at" },
];

customers.get("/export/csv", (c) => {
  const rows = customerService.listCustomersForExport({
    search: c.req.query("search"),
    tags: c.req.query("tags"),
  });

  const headers = csvHeaders(`customers-${todayIso()}.csv`);
  for (const [k, v] of Object.entries(headers)) c.header(k, v);
  return c.body(buildCsv(rows, customerCsvColumns));
});

customers.get("/:id", (c) => {
  const customer = customerService.getCustomer(c.req.param("id"));
  if (!customer) {
    return c.json({ success: false, error: "Customer not found" }, 404);
  }
  return c.json({ success: true, data: customer });
});

// --- Account statements ---

// Print-ready statement HTML for a date range (browser print → PDF), mirroring
// the invoice `/preview` model. `from`/`to` are optional (default: year-to-date).
customers.get("/:id/statement", (c) => {
  const { from, to } = statementRange(c.req.query("from"), c.req.query("to"));
  const html = renderStatementHtml(c.req.param("id"), from, to);
  if (!html) return c.json({ success: false, error: "Customer not found" }, 404);
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:;",
  );
  return c.html(html);
});

const statementSendSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  to_email: z.string().email().optional().or(z.literal("")),
  subject: z.string().max(255).optional(),
  message: z.string().max(2000).optional(),
});

// Email the statement to the customer (inline HTML; no attachment, matching the
// app's link/HTML email model — there is no server-side PDF generation).
customers.post("/:id/statement/send", async (c) => {
  const id = c.req.param("id");
  const parsed = statementSendSchema.parse(await c.req.json().catch(() => ({})));
  const { from, to } = statementRange(parsed.from, parsed.to);

  const data = buildStatementData(id, from, to);
  if (!data) return c.json({ success: false, error: "Customer not found" }, 404);

  const recipient = parsed.to_email?.trim() || data.customer.email;
  if (!recipient) return c.json({ success: false, error: "No recipient email address" }, 400);

  const { isEmailConfigured, sendEmail } = await import("../services/email.service");
  if (!(await isEmailConfigured())) {
    return c.json({ success: false, error: "Email is not configured" }, 400);
  }

  const { statementDeliveryEmail } = await import("../services/email-templates");
  const email = statementDeliveryEmail({
    company_name: data.company.name || "Inkvoice",
    customer_name: data.customer.name,
    period_from: data.period.from,
    period_to: data.period.to,
    closing_balance: data.closing_balance,
    opening_balance: data.opening_balance,
    currency: data.currency,
    lines: data.lines,
    labels: data.i18n,
    custom_message: parsed.message,
  });

  const result = await sendEmail({
    to: recipient,
    subject: parsed.subject || email.subject,
    html: email.html,
    text: email.text,
  });
  if (!result.success) {
    const msg = result.error || "Email could not be delivered";
    return c.json({ success: false, error: msg }, msg === "SMTP is not configured" ? 400 : 502);
  }
  return c.json({ success: true, data: { message: "Statement sent" } });
});

const customerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  address_line1: z.string().max(255).optional().or(z.literal("")),
  address_line2: z.string().max(255).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  state: z.string().max(100).optional().or(z.literal("")),
  postal_code: z.string().max(20).optional().or(z.literal("")),
  country: z.string().max(2).optional().or(z.literal("")),
  tax_id: z.string().max(50).optional().or(z.literal("")),
  tax_number: z.string().max(50).optional().or(z.literal("")),
  einvoice_format: z.enum(["", "zugferd", "xrechnung", "peppol", "auto"]).optional(),
  leitweg_id: z.string().max(80).optional().or(z.literal("")),
  einvoice_receiver_id: z.string().max(200).optional().or(z.literal("")),
  einvoice_receiver_scheme: z.string().max(50).optional().or(z.literal("")),
  siren: z.string().max(9).optional().or(z.literal("")),
  siret: z.string().max(14).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
  language: z.string().max(35).optional().or(z.literal("")),
  default_template_id: z.string().max(64).optional().nullable().or(z.literal("")),
  currency: z.string().max(3).optional().or(z.literal("")),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
});

const tagListSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
});

customers.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = customerSchema.parse(body);
  const customer = customerService.createCustomer(parsed);
  logActivity({
    user_id: c.get("userId"),
    user_name: c.get("user")?.username,
    action: "created",
    resource_type: "customer",
    resource_id: customer.id,
    metadata: { customer_name: customer.name },
  });
  return c.json({ success: true, data: customer }, 201);
});

customers.put("/:id", async (c) => {
  const body = await c.req.json();
  const parsed = customerSchema.parse(body);
  const customer = customerService.updateCustomer(c.req.param("id"), parsed);
  if (!customer) {
    return c.json({ success: false, error: "Customer not found" }, 404);
  }
  logActivity({
    user_id: c.get("userId"),
    user_name: c.get("user")?.username,
    action: "updated",
    resource_type: "customer",
    resource_id: customer.id,
    metadata: { customer_name: customer.name },
  });
  return c.json({ success: true, data: customer });
});

// Replace tags on a customer (full replace, no status restrictions).
customers.put("/:id/tags", async (c) => {
  const body = await c.req.json();
  const parsed = tagListSchema.parse(body);
  const id = c.req.param("id");
  const customer = customerService.getCustomer(id);
  if (!customer) return c.json({ success: false, error: "Customer not found" }, 404);
  setItemTags(id, "customer", parsed.tags);
  return c.json({ success: true, data: { tags: getTagsForItem(id, "customer") } });
});

customers.delete("/:id", (c) => {
  const id = c.req.param("id");
  const customer = customerService.getCustomer(id);
  const result = customerService.deleteCustomer(id);
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 409);
  }
  logActivity({
    user_id: c.get("userId"),
    user_name: c.get("user")?.username,
    action: "deleted",
    resource_type: "customer",
    resource_id: id,
    metadata: customer ? { customer_name: customer.name } : undefined,
  });
  return c.json({ success: true });
});

const batchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  action: z.enum(["delete"]),
});

/**
 * Two-step CSV import:
 *
 *   1. POST /import/preview with the CSV file → returns headers + first N row
 *      samples so the UI can ask the user which CSV columns map to which
 *      customer fields.
 *   2. POST /import with `mapping` (CSV column index → customer field) and
 *      `dry_run: true` to validate, or `dry_run: false` to actually insert.
 *
 * Splitting the steps keeps the client logic simple and lets us reject
 * malformed files before touching the DB.
 */
const CUSTOMER_FIELDS = [
  "name",
  "email",
  "phone",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "postal_code",
  "country",
  "tax_id",
  "notes",
] as const;
type CustomerField = (typeof CUSTOMER_FIELDS)[number];

const importMappingSchema = z.object({
  csv: z.string().min(1).max(5_000_000),
  /** Map CSV column index → customer field name. Indexes outside the file are ignored. */
  mapping: z.record(z.string(), z.enum(CUSTOMER_FIELDS)),
  dry_run: z.boolean().default(false),
});

customers.post("/import/preview", async (c) => {
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

  // Heuristic auto-mapping: if a CSV header matches a known field name (case
  // / whitespace insensitive), suggest it. The UI uses this as the default.
  const suggested: Record<string, CustomerField> = {};
  parsed.headers.forEach((h, i) => {
    const norm = h.toLowerCase().trim().replace(/\s+/g, "_");
    for (const f of CUSTOMER_FIELDS) {
      if (norm === f || norm === f.replace("_", "")) {
        suggested[String(i)] = f;
        break;
      }
    }
    // Common aliases
    if (!suggested[String(i)]) {
      if (norm === "vat" || norm === "vat_number" || norm === "tax_number") {
        suggested[String(i)] = "tax_id";
      } else if (norm === "zip" || norm === "zipcode") {
        suggested[String(i)] = "postal_code";
      } else if (norm === "address" || norm === "street") {
        suggested[String(i)] = "address_line1";
      }
    }
  });

  return c.json({
    success: true,
    data: {
      headers: parsed.headers,
      sample_rows: parsed.rows.slice(0, 5),
      total_rows: parsed.rows.length,
      suggested_mapping: suggested,
      available_fields: CUSTOMER_FIELDS,
    },
  });
});

customers.post("/import", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = importMappingSchema.parse(body);
  const csv = parseCsv(parsed.csv);
  if (csv.headers.length === 0) {
    return c.json({ success: false, error: "CSV is empty" }, 400);
  }

  // Resolve mapping: { columnIndex: field } → flat array of field-or-null per column
  const mappingByIndex: (CustomerField | null)[] = csv.headers.map((_, i) => {
    return parsed.mapping[String(i)] ?? null;
  });

  // The "name" field is required for every customer
  if (!mappingByIndex.includes("name")) {
    return c.json({ success: false, error: "Mapping must include the 'name' field" }, 400);
  }

  const errors: { row: number; reason: string }[] = [];
  const validRows: Partial<Customer>[] = [];

  csv.rows.forEach((row, idx) => {
    const customer: Partial<Customer> = {};
    mappingByIndex.forEach((field, colIdx) => {
      if (field) {
        const value = (row[colIdx] ?? "").trim();
        if (value) (customer as Record<string, string>)[field] = value;
      }
    });
    if (!customer.name) {
      // Row +2 because header is row 1 and idx is 0-based
      errors.push({ row: idx + 2, reason: "Missing required field 'name'" });
      return;
    }
    if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) {
      errors.push({ row: idx + 2, reason: `Invalid email: ${customer.email}` });
      return;
    }
    validRows.push(customer);
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
      customerService.createCustomer(data);
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

customers.post("/batch", async (c) => {
  const body = await c.req.json();
  const parsed = batchSchema.parse(body);
  const errors: { id: string; reason: string }[] = [];
  let succeeded = 0;

  for (const id of parsed.ids) {
    const result = customerService.deleteCustomer(id);
    if (result.success) {
      succeeded++;
    } else {
      errors.push({ id, reason: result.error || "Cannot delete" });
    }
  }

  return c.json({ success: true, data: { succeeded, failed: errors.length, errors } });
});

// --- Saved payment methods ---
//
// No route-level permission guard here, matching every other route in this
// file: access control is the blanket authMiddleware applied to /api/v1/*
// in app.ts, not a per-route requirePermission check.

// Display metadata only, the same reduced shape the customer-facing portal
// returns (routes/public.ts). Gateway identifiers stay server-side.
customers.get("/:id/payment-methods", (c) => {
  const id = c.req.param("id");
  const customer = customerService.getCustomer(id);
  if (!customer) return c.json({ success: false, error: "Customer not found" }, 404);

  const data = listMethodsForCustomer(id).map((m) => ({
    id: m.id,
    brand: m.brand,
    last4: m.last4,
    exp_month: m.exp_month,
    exp_year: m.exp_year,
    is_default: m.is_default,
    created_at: m.created_at,
  }));

  return c.json({ success: true, data });
});

customers.delete("/:id/payment-methods/:methodId", async (c) => {
  const result = await deleteMethod(c.req.param("methodId"), c.req.param("id"));
  if (!result.success) {
    // "Not found" is the caller's fault, anything else is the gateway's.
    const status = result.error === "Payment method not found" ? 404 : 502;
    return c.json({ success: false, error: result.error }, status);
  }
  return c.json({ success: true, data: { message: "Payment method removed" } });
});

// --- Client portal access management ---

customers.post("/:id/portal", async (c) => {
  const id = c.req.param("id");
  const customer = customerService.getCustomer(id);
  if (!customer) return c.json({ success: false, error: "Customer not found" }, 404);

  const result = customerService.enableCustomerPortal(id);
  if (!result) return c.json({ success: false, error: "Customer not found" }, 404);

  // Best-effort welcome email — don't fail the toggle if SMTP isn't configured.
  let emailStatus: "sent" | "skipped" | "failed" = "skipped";
  try {
    const { isEmailConfigured, sendEmail } = await import("../services/email.service");
    if ((await isEmailConfigured()) && customer.email) {
      const { portalWelcomeEmail } = await import("../services/email-templates");
      const { getSetting } = await import("../services/settings.service");
      const baseUrl = getSetting("app_url") || `${new URL(c.req.url).origin}`;
      const portalUrl = `${baseUrl}/portal/${result.token}`;
      const tpl = portalWelcomeEmail({
        company_name: getSetting("company_name") || "Inkvoice",
        customer_name: customer.name,
        portal_url: portalUrl,
      });
      const sent = await sendEmail({
        to: customer.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
      emailStatus = sent.success ? "sent" : "failed";
    }
  } catch {
    emailStatus = "failed";
  }

  return c.json({ success: true, data: { token: result.token, email_status: emailStatus } });
});

customers.delete("/:id/portal", (c) => {
  const ok = customerService.disableCustomerPortal(c.req.param("id"));
  if (!ok) return c.json({ success: false, error: "Customer not found" }, 404);
  return c.json({ success: true });
});

export { customers };
