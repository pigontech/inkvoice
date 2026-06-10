import crypto from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../database/connection";
import { logActivity } from "../services/activity.service";
import { isEmailConfigured, sendEmail } from "../services/email.service";
import { invoiceDeliveryEmail } from "../services/email-templates";
import * as invoiceService from "../services/invoice.service";
import { dispatchEvent } from "../services/outgoing-webhooks.service";
import * as paymentService from "../services/payment.service";
import * as quoteService from "../services/quote.service";
import { getReminderLog } from "../services/reminder.service";
import { getAllSettings } from "../services/settings.service";
import type { Invoice } from "../types/invoice";
import { buildCsv, type CsvColumn, csvHeaders } from "../utils/csv";
import { formatCurrency } from "../utils/currency";
import { todayIso } from "../utils/date";
import { buildXmlInvoiceData } from "../xml/build-data";
import { getProfile, listProfiles } from "../xml/profile-registry";

const invoices = new Hono();

invoices.get("/", (c) => {
  const status = c.req.query("status");
  const customer_id = c.req.query("customer_id");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const search = c.req.query("search");
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") || "20", 10) || 20), 100);

  const type = c.req.query("type");
  const updated_since = c.req.query("updated_since");
  const data = invoiceService.listInvoices({
    status,
    customer_id,
    from,
    to,
    search,
    type,
    updated_since,
    page,
    limit,
  });
  return c.json({ success: true, data });
});

invoices.get("/next-number", (c) => {
  const number = invoiceService.getNextNumber();
  return c.json({ success: true, data: { number } });
});

// Trash routes — must be before /:id to avoid parameter matching
invoices.get("/trash/list", (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") || "20", 10) || 20), 100);
  const data = invoiceService.listTrashedInvoices({ page, limit });
  return c.json({ success: true, data });
});

const trashBatchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  action: z.enum(["restore", "permanent-delete"]),
});

invoices.post("/trash/batch", async (c) => {
  const body = await c.req.json();
  const parsed = trashBatchSchema.parse(body);
  const errors: { id: string; reason: string }[] = [];
  let succeeded = 0;

  for (const id of parsed.ids) {
    const result =
      parsed.action === "restore"
        ? invoiceService.restoreInvoice(id)
        : invoiceService.permanentlyDeleteInvoice(id);
    if (result.success) {
      succeeded++;
    } else {
      errors.push({ id, reason: result.error || "Failed" });
    }
  }

  return c.json({ success: true, data: { succeeded, failed: errors.length, errors } });
});

// Batch operations — must be before /:id
const batchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  action: z.enum(["delete", "mark-paid", "mark-sent", "void"]),
});

invoices.post("/batch", async (c) => {
  const body = await c.req.json();
  const parsed = batchSchema.parse(body);
  const errors: { id: string; reason: string }[] = [];
  let succeeded = 0;

  for (const id of parsed.ids) {
    try {
      if (parsed.action === "delete") {
        const result = invoiceService.deleteInvoice(id);
        if (result.success) {
          succeeded++;
        } else {
          errors.push({ id, reason: result.error || "Cannot delete" });
        }
      } else if (parsed.action === "mark-paid") {
        const result = invoiceService.markPaid(id);
        if (result) {
          succeeded++;
        } else {
          errors.push({ id, reason: "Invoice not found or cannot be marked paid" });
        }
      } else if (parsed.action === "mark-sent") {
        const result = invoiceService.markSent(id);
        if (result) {
          succeeded++;
        } else {
          errors.push({ id, reason: "Invoice not found or cannot be marked sent" });
        }
      } else if (parsed.action === "void") {
        const result = invoiceService.voidInvoice(id);
        if (result) {
          succeeded++;
        } else {
          errors.push({ id, reason: "Invoice not found or already voided" });
        }
      }
    } catch {
      errors.push({ id, reason: "Unexpected error" });
    }
  }

  return c.json({ success: true, data: { succeeded, failed: errors.length, errors } });
});

// CSV export — before parameterized routes
type InvoiceRow = Invoice & { customer_name: string };

const invoiceCsvColumns: CsvColumn<InvoiceRow>[] = [
  { header: "Invoice Number", key: "invoice_number" },
  { header: "Customer", key: "customer_name" },
  { header: "Status", key: "status" },
  { header: "Issue Date", key: "issue_date" },
  { header: "Due Date", key: "due_date" },
  { header: "Subtotal", key: "subtotal" },
  { header: "Tax", key: "tax_total" },
  { header: "Discount", key: "discount_amount" },
  { header: "Total", key: "total" },
  { header: "Currency", key: "currency" },
  { header: "Created", key: "created_at" },
];

invoices.get("/export/csv", (c) => {
  const rows = invoiceService.listInvoicesForExport({
    status: c.req.query("status"),
    customer_id: c.req.query("customer_id"),
    from: c.req.query("from"),
    to: c.req.query("to"),
    search: c.req.query("search"),
  });

  const headers = csvHeaders(`invoices-${todayIso()}.csv`);
  for (const [k, v] of Object.entries(headers)) c.header(k, v);
  return c.body(buildCsv(rows, invoiceCsvColumns));
});

// Credit note routes
invoices.get("/next-cn-number", (c) => {
  const number = invoiceService.getNextCreditNoteNumber();
  return c.json({ success: true, data: { number } });
});

// Parameterized routes — after all literal path routes
const itemSchema = z.object({
  product_id: z.string().optional().nullable(),
  description: z.string().min(1).max(500),
  quantity: z.number().min(0),
  unit_price: z.number().min(0),
  unit: z.string().max(20).optional(),
  tax_id: z.string().optional().nullable(),
  tax_ids: z.array(z.string()).optional(),
  tax_rate: z.number().min(0).max(100).optional(),
  sort_order: z.number().optional(),
});

const invoiceSchema = z.object({
  customer_id: z.string().min(1),
  issue_date: z.string().min(1),
  due_date: z.string().optional().nullable(),
  invoice_number: z.string().optional(),
  notes: z.string().max(2000).optional().nullable(),
  payment_terms: z.string().max(500).optional().nullable(),
  currency: z.string().max(3).optional(),
  exchange_rate: z.number().positive().optional(),
  discount_type: z.enum(["percentage", "amount"]).optional().nullable(),
  discount_value: z.number().min(0).optional(),
  prices_include_tax: z.boolean().optional(),
  locale: z.string().max(10).optional().nullable(),
  template_id: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1),
});

invoices.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = invoiceSchema.parse(body);
  const invoice = invoiceService.createInvoice(parsed);
  logActivity({
    user_id: c.get("userId"),
    user_name: c.get("user")?.username,
    action: "created",
    resource_type: "invoice",
    resource_id: invoice.id,
    metadata: { invoice_number: invoice.invoice_number },
  });
  void dispatchEvent("invoice.created", {
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    total: invoice.total,
    currency: invoice.currency,
  });
  return c.json({ success: true, data: invoice }, 201);
});

invoices.get("/:id", (c) => {
  const invoice = invoiceService.getInvoice(c.req.param("id"));
  if (!invoice) {
    return c.json({ success: false, error: "Invoice not found" }, 404);
  }
  return c.json({ success: true, data: invoice });
});

invoices.put("/:id", async (c) => {
  const body = await c.req.json();
  const parsed = invoiceSchema.parse(body);
  const invoice = invoiceService.updateInvoice(c.req.param("id"), parsed);
  if (!invoice) {
    return c.json({ success: false, error: "Invoice not found or not editable" }, 404);
  }
  return c.json({ success: true, data: invoice });
});

invoices.delete("/:id", (c) => {
  const result = invoiceService.deleteInvoice(c.req.param("id"));
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 400);
  }
  return c.json({ success: true });
});

invoices.post("/:id/publish", (c) => {
  const invoice = invoiceService.publishInvoice(c.req.param("id"));
  if (!invoice) {
    return c.json({ success: false, error: "Invoice not found or cannot be published" }, 400);
  }
  return c.json({ success: true, data: invoice });
});

invoices.post("/:id/unpublish", (c) => {
  const invoice = invoiceService.unpublishInvoice(c.req.param("id"));
  if (!invoice) {
    return c.json({ success: false, error: "Invoice not found or not published" }, 400);
  }
  return c.json({ success: true, data: invoice });
});

invoices.post("/:id/void", async (c) => {
  const invoice = invoiceService.voidInvoice(c.req.param("id"));
  if (!invoice) {
    return c.json({ success: false, error: "Invoice not found or cannot be voided" }, 400);
  }
  logActivity({
    user_id: c.get("userId"),
    user_name: c.get("user")?.username,
    action: "voided",
    resource_type: "invoice",
    resource_id: invoice.id,
    metadata: { invoice_number: invoice.invoice_number },
  });
  // Fire-and-forget — webhook failures must not block the user response.
  void dispatchEvent("invoice.voided", {
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    customer_name: (invoice as { customer_name?: string }).customer_name ?? null,
  });
  return c.json({ success: true, data: invoice });
});

invoices.post("/:id/mark-paid", async (c) => {
  const invoice = invoiceService.markPaid(c.req.param("id"));
  if (!invoice) {
    return c.json({ success: false, error: "Invoice not found or cannot be marked paid" }, 404);
  }
  logActivity({
    user_id: c.get("userId"),
    user_name: c.get("user")?.username,
    action: "paid",
    resource_type: "invoice",
    resource_id: invoice.id,
    metadata: { invoice_number: invoice.invoice_number },
  });
  void dispatchEvent("invoice.paid", {
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    total: invoice.total,
    currency: invoice.currency,
    customer_name: (invoice as { customer_name?: string }).customer_name ?? null,
  });
  return c.json({ success: true, data: invoice });
});

invoices.post("/:id/mark-complete", (c) => {
  const invoice = invoiceService.markComplete(c.req.param("id"));
  if (!invoice) {
    return c.json({ success: false, error: "Invoice not found or cannot be marked complete" }, 404);
  }
  logActivity({
    user_id: c.get("userId"),
    user_name: c.get("user")?.username,
    action: "completed",
    resource_type: "invoice",
    resource_id: invoice.id,
    metadata: { invoice_number: invoice.invoice_number },
  });
  return c.json({ success: true, data: invoice });
});

invoices.post("/:id/mark-sent", async (c) => {
  const invoice = invoiceService.markSent(c.req.param("id"));
  if (!invoice) {
    return c.json({ success: false, error: "Invoice not found or cannot be marked sent" }, 404);
  }
  logActivity({
    user_id: c.get("userId"),
    user_name: c.get("user")?.username,
    action: "sent",
    resource_type: "invoice",
    resource_id: invoice.id,
    metadata: { invoice_number: invoice.invoice_number },
  });
  void dispatchEvent("invoice.sent", {
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    customer_name: (invoice as { customer_name?: string }).customer_name ?? null,
  });
  return c.json({ success: true, data: invoice });
});

invoices.post("/:id/duplicate", (c) => {
  const invoice = invoiceService.duplicateInvoice(c.req.param("id"));
  if (!invoice) {
    return c.json({ success: false, error: "Invoice not found" }, 404);
  }
  return c.json({ success: true, data: invoice }, 201);
});

invoices.post("/:id/duplicate-as-quote", (c) => {
  const result = quoteService.createQuoteFromInvoice(c.req.param("id"));
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 400);
  }
  return c.json({ success: true, data: result.data }, 201);
});

invoices.post("/:id/credit-note", (c) => {
  const result = invoiceService.createCreditNote(c.req.param("id"));
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 400);
  }
  return c.json({ success: true, data: result.data }, 201);
});

invoices.get("/:id/credit-notes", (c) => {
  const creditNotes = invoiceService.listCreditNotes(c.req.param("id"));
  return c.json({ success: true, data: creditNotes });
});

// Send invoice via email
invoices.post("/:id/send", async (c) => {
  if (!(await isEmailConfigured())) {
    return c.json({ success: false, error: "Email is not configured" }, 400);
  }

  const invoice = invoiceService.getInvoice(c.req.param("id"));
  if (!invoice) return c.json({ success: false, error: "Invoice not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const customerEmail = body.to || invoice.customer?.email;
  if (!customerEmail) {
    return c.json({ success: false, error: "No recipient email address" }, 400);
  }

  // Auto-publish if not published
  if (!invoice.is_published) {
    invoiceService.publishInvoice(invoice.id);
  }
  // Auto-mark as sent if draft
  if (invoice.status === "draft") {
    invoiceService.markSent(invoice.id);
  }

  const settings = getAllSettings();
  const publicUrl = invoice.share_token
    ? `${c.req.header("origin") || ""}/public/invoice/${invoice.share_token}`
    : null;

  const email = invoiceDeliveryEmail({
    company_name: settings.company_name || "Inkvoice",
    customer_name: invoice.customer?.name || "Customer",
    invoice_number: invoice.invoice_number,
    total: formatCurrency(invoice.total, invoice.currency),
    currency: invoice.currency,
    due_date: invoice.due_date,
    public_url: publicUrl,
    custom_message: body.message,
  });

  const result = await sendEmail({
    to: customerEmail,
    subject: body.subject || email.subject,
    html: email.html,
    text: email.text,
    from: typeof body.from === "string" && body.from.trim() ? body.from.trim() : undefined,
    replyTo:
      typeof body.reply_to === "string" && body.reply_to.trim() ? body.reply_to.trim() : undefined,
  });

  if (!result.success) {
    const msg = result.error || "Email could not be delivered";
    const status =
      msg === "SMTP is not configured"
        ? 400
        : msg.toLowerCase().includes("recipient") || msg.toLowerCase().includes("address")
          ? 400
          : 502;
    return c.json({ success: false, error: msg }, status);
  }

  return c.json({ success: true, data: { message: "Invoice sent" } });
});

// Payment routes
const paymentSchema = z.object({
  amount: z.number().positive(),
  payment_date: z.string().min(1),
  method: z.enum(["bank_transfer", "cash", "card", "check", "other"]).optional(),
  reference: z.string().max(255).optional(),
  notes: z.string().max(1000).optional(),
});

invoices.post("/:id/payments", async (c) => {
  const body = await c.req.json();
  const parsed = paymentSchema.parse(body);
  const result = paymentService.recordPayment(c.req.param("id"), parsed);
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 400);
  }
  return c.json({ success: true, data: result.data }, 201);
});

invoices.get("/:id/payments", (c) => {
  const payments = paymentService.listPayments(c.req.param("id"));
  return c.json({ success: true, data: payments });
});

invoices.delete("/:id/payments/:paymentId", (c) => {
  const result = paymentService.deletePayment(c.req.param("paymentId"));
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 404);
  }
  return c.json({ success: true });
});

invoices.get("/:id/reminders", (c) => {
  const log = getReminderLog(c.req.param("id"));
  return c.json({ success: true, data: log });
});

invoices.post("/:id/restore", (c) => {
  const result = invoiceService.restoreInvoice(c.req.param("id"));
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 400);
  }
  return c.json({ success: true });
});

invoices.delete("/:id/permanent", (c) => {
  const result = invoiceService.permanentlyDeleteInvoice(c.req.param("id"));
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 400);
  }
  return c.json({ success: true });
});

invoices.get("/:id/preview", async (c) => {
  const { renderInvoiceHtml } = await import("../services/pdf.service");
  const id = c.req.param("id");
  const html = renderInvoiceHtml(id);
  if (!html) {
    return c.json({ success: false, error: "Invoice not found" }, 404);
  }
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:;",
  );
  return c.html(html);
});

// XML export endpoints
invoices.get("/xml-profiles", (c) => {
  return c.json({ success: true, data: listProfiles() });
});

invoices.get("/:id/xml/:profileId", (c) => {
  const { id, profileId } = c.req.param();
  const profile = getProfile(profileId);
  if (!profile) return c.json({ success: false, error: "XML profile not found" }, 400);

  try {
    const data = buildXmlInvoiceData(id);
    const xml = profile.generateXml(data);
    c.header("Content-Type", profile.getMimeType());
    c.header(
      "Content-Disposition",
      `attachment; filename="${data.invoice_number}-${profileId}.xml"`,
    );
    return c.body(xml);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 404);
  }
});

// Comment thread (staff side). Customer-side endpoints live under public.ts.
invoices.get("/:id/comments", (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const exists = db.query("SELECT id FROM invoices WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!exists) return c.json({ success: false, error: "Invoice not found" }, 404);
  const comments = db
    .query(
      "SELECT id, author_type, author_name, body, created_at FROM invoice_comments WHERE invoice_id = ? ORDER BY created_at ASC",
    )
    .all(id);
  return c.json({ success: true, data: comments });
});

invoices.post("/:id/comments", async (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const exists = db.query("SELECT id FROM invoices WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!exists) return c.json({ success: false, error: "Invoice not found" }, 404);

  const body = (await c.req.json()) as { body?: string };
  const text = (body.body ?? "").trim();
  if (!text) return c.json({ success: false, error: "Comment body required" }, 400);
  if (text.length > 4000) return c.json({ success: false, error: "Comment too long" }, 400);

  const user = c.get("user") as { username?: string } | undefined;
  const author = user?.username || "Staff";

  const cid = crypto.randomBytes(16).toString("hex");
  db.run(
    "INSERT INTO invoice_comments (id, invoice_id, author_type, author_name, body) VALUES (?, ?, 'staff', ?, ?)",
    [cid, id, author, text],
  );
  const created = db
    .query(
      "SELECT id, author_type, author_name, body, created_at FROM invoice_comments WHERE id = ?",
    )
    .get(cid);
  return c.json({ success: true, data: created }, 201);
});

export { invoices };
