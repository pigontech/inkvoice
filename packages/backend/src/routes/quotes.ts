import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { logActivity } from "../services/activity.service";
import { isEmailConfigured, sendEmail } from "../services/email.service";
import * as quoteService from "../services/quote.service";
import { getAllSettings } from "../services/settings.service";
import { formatCurrency } from "../utils/currency";

const quotes = new Hono();

/** Records a quote event with the acting user, mirroring the invoice routes. */
function logQuoteActivity(
  c: Context,
  action: string,
  quote: { id: string; quote_number?: string | null },
) {
  logActivity({
    user_id: c.get("userId"),
    user_name: c.get("user")?.username,
    action,
    resource_type: "quote",
    resource_id: quote.id,
    metadata: quote.quote_number ? { quote_number: quote.quote_number } : undefined,
  });
}

quotes.get("/", (c) => {
  const status = c.req.query("status");
  const customer_id = c.req.query("customer_id");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const search = c.req.query("search");
  const updated_since = c.req.query("updated_since");
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") || "20", 10) || 20), 100);

  const data = quoteService.listQuotes({
    status,
    customer_id,
    from,
    to,
    search,
    updated_since,
    page,
    limit,
  });
  return c.json({ success: true, data });
});

quotes.get("/next-number", (c) => {
  const number = quoteService.getNextNumber();
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
  tax_rate: z.number().min(0).max(100).optional(),
  sort_order: z.number().optional(),
});

const quoteSchema = z.object({
  customer_id: z.string().min(1),
  issue_date: z.string().min(1),
  valid_until: z.string().optional().nullable(),
  quote_number: z.string().optional(),
  notes: z.string().max(2000).optional().nullable(),
  currency: z.string().max(3).optional(),
  discount_type: z.enum(["percentage", "amount"]).optional().nullable(),
  discount_value: z.number().min(0).optional(),
  locale: z.string().max(10).optional().nullable(),
  template_id: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1),
});

quotes.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = quoteSchema.parse(body);
  const quote = quoteService.createQuote(parsed);
  logQuoteActivity(c, "created", quote);
  return c.json({ success: true, data: quote }, 201);
});

quotes.get("/:id", (c) => {
  const quote = quoteService.getQuote(c.req.param("id"));
  if (!quote) {
    return c.json({ success: false, error: "Quote not found" }, 404);
  }
  return c.json({ success: true, data: quote });
});

quotes.put("/:id", async (c) => {
  const body = await c.req.json();
  const parsed = quoteSchema.parse(body);
  const quote = quoteService.updateQuote(c.req.param("id"), parsed);
  if (!quote) {
    return c.json({ success: false, error: "Quote not found or not editable" }, 404);
  }
  logQuoteActivity(c, "updated", quote);
  return c.json({ success: true, data: quote });
});

quotes.delete("/:id", (c) => {
  const id = c.req.param("id");
  const quote = quoteService.getQuote(id);
  const result = quoteService.deleteQuote(id);
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 400);
  }
  logQuoteActivity(c, "deleted", { id, quote_number: quote?.quote_number });
  return c.json({ success: true });
});

quotes.post("/:id/publish", (c) => {
  const quote = quoteService.publishQuote(c.req.param("id"));
  if (!quote) {
    return c.json({ success: false, error: "Quote not found or cannot be published" }, 400);
  }
  logQuoteActivity(c, "published", quote);
  return c.json({ success: true, data: quote });
});

quotes.post("/:id/send", async (c) => {
  const quote = quoteService.getQuote(c.req.param("id"));
  if (!quote) return c.json({ success: false, error: "Quote not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const customerEmail = body.to || quote.customer?.email;
  const emailConfigured = await isEmailConfigured();

  if (customerEmail && !emailConfigured) {
    return c.json({ success: false, error: "Email is not configured" }, 400);
  }

  // Auto-publish if not published
  if (!quote.is_published) quoteService.publishQuote(quote.id);

  // Mark as sent
  quoteService.sendQuote(quote.id);

  if (customerEmail && emailConfigured) {
    const settings = getAllSettings();
    const publicUrl = quote.share_token
      ? `${c.req.header("origin") || ""}/public/quote/${quote.share_token}`
      : null;
    const fromName = settings.email_from_name || settings.company_name || "Inkvoice";
    const subject = body.subject || `Quote ${quote.quote_number} from ${fromName}`;

    const result = await sendEmail({
      to: customerEmail,
      subject,
      html: `<p>Dear ${quote.customer?.name || "Customer"},</p>
<p>Please find your quote <strong>${quote.quote_number}</strong> for <strong>${formatCurrency(quote.total, quote.currency)}</strong>.</p>
${publicUrl ? `<p><a href="${publicUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">View Quote</a></p>` : ""}
${body.message ? `<p>${body.message}</p>` : ""}`,
      text: `Quote ${quote.quote_number} - ${formatCurrency(quote.total, quote.currency)}\n${publicUrl ? `View: ${publicUrl}` : ""}`,
      from: typeof body.from === "string" && body.from.trim() ? body.from.trim() : undefined,
      replyTo:
        typeof body.reply_to === "string" && body.reply_to.trim()
          ? body.reply_to.trim()
          : undefined,
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
  }

  const updated = quoteService.getQuote(c.req.param("id"));
  if (updated) logQuoteActivity(c, "sent", updated);
  return c.json({ success: true, data: updated });
});

quotes.post("/:id/accept", (c) => {
  const quote = quoteService.acceptQuote(c.req.param("id"));
  if (!quote) {
    return c.json({ success: false, error: "Quote not found or cannot be accepted" }, 400);
  }
  logQuoteActivity(c, "accepted", quote);
  return c.json({ success: true, data: quote });
});

quotes.post("/:id/reject", (c) => {
  const quote = quoteService.rejectQuote(c.req.param("id"));
  if (!quote) {
    return c.json({ success: false, error: "Quote not found or cannot be rejected" }, 400);
  }
  logQuoteActivity(c, "rejected", quote);
  return c.json({ success: true, data: quote });
});

quotes.post("/:id/duplicate", (c) => {
  const quote = quoteService.duplicateQuote(c.req.param("id"));
  if (!quote) {
    return c.json({ success: false, error: "Quote not found" }, 404);
  }
  return c.json({ success: true, data: quote }, 201);
});

quotes.get("/:id/preview", async (c) => {
  const { renderQuoteHtml } = await import("../services/pdf.service");
  const id = c.req.param("id");
  const html = renderQuoteHtml(id);
  if (!html) {
    return c.json({ success: false, error: "Quote not found" }, 404);
  }
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:;",
  );
  return c.html(html);
});

quotes.post("/:id/convert", (c) => {
  const id = c.req.param("id");
  const result = quoteService.convertToInvoice(id);
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 400);
  }
  const quote = quoteService.getQuote(id);
  logQuoteActivity(c, "converted", { id, quote_number: quote?.quote_number });
  return c.json({ success: true, data: result.data }, 201);
});

export { quotes };
