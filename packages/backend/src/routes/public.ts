import { Hono } from "hono";
import { getDb } from "../database/connection";
import * as invoiceService from "../services/invoice.service";
import { notifyInvoiceViewed } from "../services/invoice-view.service";
import {
  getGateway,
  isGatewayEnabled,
  listEnabledGatewayMeta,
} from "../services/payment-gateways/registry";
import * as quoteService from "../services/quote.service";
import { getAllSettings, getSetting } from "../services/settings.service";
import { isStripeConfigured } from "../services/stripe.service";
import { isLikelyBot } from "../utils/user-agent";
import { buildXmlInvoiceData } from "../xml/build-data";
import { getProfile } from "../xml/profile-registry";

const publicRoutes = new Hono();

// Extension point: a deployment can report whether an online "Pay now"
// session is available for portal invoices (e.g. a platform-managed payment
// account). Standalone installs return false unless a checker is registered.
let portalOnlinePaymentChecker: (() => boolean) | null = null;

export function setPortalOnlinePaymentChecker(fn: (() => boolean) | null): void {
  portalOnlinePaymentChecker = fn;
}

publicRoutes.get("/invoices/:shareToken", (c) => {
  const shareToken = c.req.param("shareToken");
  const invoice = invoiceService.getInvoiceByShareToken(shareToken);

  if (!invoice) {
    return c.json({ success: false, error: "Invoice not found" }, 404);
  }

  // Stamp the view (skipping obvious bots/link-unfurlers). On the first real
  // view, fire notifications — but never let that delay the client's response.
  if (!isLikelyBot(c.req.header("user-agent"))) {
    const { isFirstView } = invoiceService.recordInvoiceView(invoice.id);
    if (isFirstView) {
      void notifyInvoiceViewed(invoice);
    }
  }

  const settings = getAllSettings();

  return c.json({
    success: true,
    data: {
      invoice,
      settings: {
        company_name: settings.company_name,
        company_email: settings.company_email,
        company_phone: settings.company_phone,
        company_address: settings.company_address,
        company_tax_id: settings.company_tax_id,
        company_logo: settings.company_logo,
        currency: settings.currency,
        tax_label: settings.tax_label,
      },
      // `payment_methods` lists every enabled gateway; `stripe_enabled` is kept
      // for backward compatibility with older public-page bundles.
      payment_methods: listEnabledGatewayMeta(),
      stripe_enabled: isStripeConfigured() && getSetting("stripe_enabled") === "true",
    },
  });
});

publicRoutes.post("/invoices/:shareToken/pay", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { gateway?: string };
  const gateway = getGateway(body.gateway || "stripe");
  if (!gateway || !isGatewayEnabled(gateway)) {
    return c.json({ success: false, error: "Online payments are not enabled" }, 400);
  }

  const shareToken = c.req.param("shareToken");
  const invoice = invoiceService.getInvoiceByShareToken(shareToken);
  if (!invoice) return c.json({ success: false, error: "Invoice not found" }, 404);
  if (invoice.status === "paid")
    return c.json({ success: false, error: "Invoice already paid" }, 400);
  if (invoice.status === "voided")
    return c.json({ success: false, error: "Invoice is voided" }, 400);

  const balanceDue = invoice.total - (invoice.amount_paid || 0);
  if (balanceDue <= 0) return c.json({ success: false, error: "No balance due" }, 400);

  const origin = c.req.header("origin") || "";
  try {
    const result = await gateway.createCheckout({
      invoiceId: invoice.id,
      shareToken,
      amount: balanceDue,
      currency: invoice.currency,
      customerEmail: invoice.customer?.email || null,
      successUrl: `${origin}/payment/success?token=${shareToken}`,
      cancelUrl: `${origin}/public/invoice/${shareToken}`,
    });
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: `Could not start payment: ${err.message}` }, 502);
  }
});

publicRoutes.get("/invoices/:shareToken/preview", async (c) => {
  const shareToken = c.req.param("shareToken");
  const invoice = invoiceService.getInvoiceByShareToken(shareToken);

  if (!invoice) {
    return c.json({ success: false, error: "Invoice not found" }, 404);
  }

  const { renderInvoiceHtml } = await import("../services/pdf.service");
  const html = renderInvoiceHtml(invoice.id);
  if (!html) {
    return c.json(
      {
        success: false,
        error:
          "This invoice could not be rendered. The template may be missing or invalid — please try again later.",
      },
      503,
    );
  }
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; frame-ancestors 'self';",
  );
  c.header("X-Frame-Options", "SAMEORIGIN");
  return c.html(html);
});

publicRoutes.get("/quotes/:shareToken", (c) => {
  const shareToken = c.req.param("shareToken");
  const quote = quoteService.getQuoteByShareToken(shareToken);

  if (!quote) {
    return c.json({ success: false, error: "Quote not found" }, 404);
  }

  const settings = getAllSettings();

  return c.json({
    success: true,
    data: {
      quote,
      settings: {
        company_name: settings.company_name,
        company_email: settings.company_email,
        company_phone: settings.company_phone,
        company_address: settings.company_address,
        company_tax_id: settings.company_tax_id,
        company_logo: settings.company_logo,
        currency: settings.currency,
        tax_label: settings.tax_label,
      },
    },
  });
});

publicRoutes.post("/quotes/:shareToken/accept", (c) => {
  const quote = quoteService.getQuoteByShareToken(c.req.param("shareToken"));
  if (!quote) return c.json({ success: false, error: "Quote not found" }, 404);
  if (quote.status === "accepted") return c.json({ success: true, data: { status: "accepted" } });

  const updated = quoteService.acceptQuote(quote.id);
  if (!updated)
    return c.json({ success: false, error: "This quote can no longer be accepted" }, 400);
  return c.json({ success: true, data: { status: updated.status } });
});

publicRoutes.post("/quotes/:shareToken/reject", (c) => {
  const quote = quoteService.getQuoteByShareToken(c.req.param("shareToken"));
  if (!quote) return c.json({ success: false, error: "Quote not found" }, 404);
  if (quote.status === "rejected") return c.json({ success: true, data: { status: "rejected" } });

  const updated = quoteService.rejectQuote(quote.id);
  if (!updated)
    return c.json({ success: false, error: "This quote can no longer be rejected" }, 400);
  return c.json({ success: true, data: { status: updated.status } });
});

publicRoutes.get("/quotes/:shareToken/preview", async (c) => {
  const shareToken = c.req.param("shareToken");
  const quote = quoteService.getQuoteByShareToken(shareToken);

  if (!quote) {
    return c.json({ success: false, error: "Quote not found" }, 404);
  }

  const { renderQuoteHtml } = await import("../services/pdf.service");
  const html = renderQuoteHtml(quote.id);
  if (!html) {
    return c.json(
      {
        success: false,
        error:
          "This quote could not be rendered. The template may be missing or invalid — please try again later.",
      },
      503,
    );
  }
  c.header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; frame-ancestors 'self';",
  );
  c.header("X-Frame-Options", "SAMEORIGIN");
  return c.html(html);
});

// Public XML export
publicRoutes.get("/invoices/:shareToken/xml/:profileId", (c) => {
  const { shareToken, profileId } = c.req.param();
  const profile = getProfile(profileId);
  if (!profile) return c.json({ success: false, error: "XML profile not found" }, 400);

  const invoice = invoiceService.getInvoiceByShareToken(shareToken);
  if (!invoice) return c.json({ success: false, error: "Invoice not found" }, 404);

  try {
    const data = buildXmlInvoiceData(invoice.id);
    const xml = profile.generateXml(data);
    c.header("Content-Type", profile.getMimeType());
    c.header(
      "Content-Disposition",
      `attachment; filename="${data.invoice_number}-${profileId}.xml"`,
    );
    return c.body(xml);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// --- Client Portal (per-customer portal via token) ---

publicRoutes.get("/portal/:token", (c) => {
  const token = c.req.param("token");
  const db = getDb();

  // Look up portal token (table may be absent on older databases)
  let portalToken: { customer_id: string } | null = null;
  try {
    portalToken = db.query("SELECT customer_id FROM portal_tokens WHERE token = ?").get(token) as {
      customer_id: string;
    } | null;
  } catch {
    // Table doesn't exist in self-hosted mode
    return c.json({ success: false, error: "Portal not available" }, 404);
  }

  if (!portalToken) {
    return c.json({ success: false, error: "Portal link not found or expired" }, 404);
  }

  // Get customer record
  const customer = db
    .query("SELECT id, name, email FROM customers WHERE id = ?")
    .get(portalToken.customer_id) as { id: string; name: string; email: string | null } | null;

  if (!customer) {
    return c.json({ success: false, error: "Customer not found" }, 404);
  }

  // Get all non-draft, non-deleted invoices for this customer
  const invoices = db
    .query(
      `SELECT id, invoice_number, status, total, currency, issue_date, due_date
       FROM invoices
       WHERE customer_id = ? AND deleted_at IS NULL AND status != 'draft'
       ORDER BY issue_date DESC`,
    )
    .all(portalToken.customer_id) as Array<{
    id: string;
    invoice_number: string;
    status: string;
    total: number;
    currency: string;
    issue_date: string;
    due_date: string | null;
  }>;

  // Whether an online "Pay now" session can be offered for these invoices.
  let stripeEnabled = false;
  try {
    stripeEnabled = portalOnlinePaymentChecker?.() ?? false;
  } catch {
    stripeEnabled = false;
  }

  return c.json({
    success: true,
    data: {
      customer: { name: customer.name, email: customer.email },
      invoices,
      stripe_enabled: stripeEnabled,
    },
  });
});

// Helper: resolve portal token → customer_id, or null.
function resolvePortalCustomer(token: string): { id: string; name: string } | null {
  const db = getDb();
  let row: { customer_id: string } | null = null;
  try {
    row = db.query("SELECT customer_id FROM portal_tokens WHERE token = ?").get(token) as {
      customer_id: string;
    } | null;
  } catch {
    return null;
  }
  if (!row) return null;
  const customer = db
    .query("SELECT id, name FROM customers WHERE id = ? AND portal_enabled = 1")
    .get(row.customer_id) as { id: string; name: string } | null;
  return customer ?? null;
}

publicRoutes.get("/portal/:token/invoices.zip", async (c) => {
  const token = c.req.param("token");
  const yearParam = c.req.query("year");
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
  if (!Number.isFinite(year) || year < 2000 || year > 2200) {
    return c.json({ success: false, error: "Invalid year" }, 400);
  }

  const customer = resolvePortalCustomer(token);
  if (!customer) return c.json({ success: false, error: "Portal link not found or expired" }, 404);

  const db = getDb();
  const invoices = db
    .query(
      `SELECT id, invoice_number FROM invoices
       WHERE customer_id = ? AND deleted_at IS NULL AND status != 'draft'
         AND substr(issue_date, 1, 4) = ?
       ORDER BY issue_date ASC`,
    )
    .all(customer.id, String(year)) as { id: string; invoice_number: string }[];

  if (invoices.length === 0) {
    return c.json({ success: false, error: "No invoices for this year" }, 404);
  }

  const { renderInvoiceHtml } = await import("../services/pdf.service");
  const { buildZip } = await import("../utils/zip");
  const entries = invoices
    .map((inv) => {
      const html = renderInvoiceHtml(inv.id);
      if (!html) return null;
      const safe = inv.invoice_number.replace(/[^A-Za-z0-9._-]/g, "_");
      return { name: `${safe}.html`, data: html };
    })
    .filter((e): e is { name: string; data: string } => e !== null);

  const zip = buildZip(entries);
  const safeCustomer = customer.name.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(zip.buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="invoices-${safeCustomer}-${year}.zip"`,
    },
  });
});

// --- Invoice comment threads ---

publicRoutes.get("/portal/:token/invoices/:invoiceId/comments", (c) => {
  const customer = resolvePortalCustomer(c.req.param("token"));
  if (!customer) return c.json({ success: false, error: "Portal link not found or expired" }, 404);

  const invoiceId = c.req.param("invoiceId");
  const db = getDb();
  const owns = db
    .query("SELECT id FROM invoices WHERE id = ? AND customer_id = ? AND deleted_at IS NULL")
    .get(invoiceId, customer.id);
  if (!owns) return c.json({ success: false, error: "Invoice not found" }, 404);

  const comments = db
    .query(
      `SELECT id, author_type, author_name, body, created_at
       FROM invoice_comments WHERE invoice_id = ? ORDER BY created_at ASC`,
    )
    .all(invoiceId);
  return c.json({ success: true, data: comments });
});

publicRoutes.post("/portal/:token/invoices/:invoiceId/comments", async (c) => {
  const customer = resolvePortalCustomer(c.req.param("token"));
  if (!customer) return c.json({ success: false, error: "Portal link not found or expired" }, 404);

  const invoiceId = c.req.param("invoiceId");
  const db = getDb();
  const owns = db
    .query("SELECT id FROM invoices WHERE id = ? AND customer_id = ? AND deleted_at IS NULL")
    .get(invoiceId, customer.id);
  if (!owns) return c.json({ success: false, error: "Invoice not found" }, 404);

  const body = (await c.req.json()) as { body?: string };
  const text = (body.body ?? "").trim();
  if (!text) return c.json({ success: false, error: "Comment body required" }, 400);
  if (text.length > 4000) return c.json({ success: false, error: "Comment too long" }, 400);

  const crypto = await import("node:crypto");
  const id = crypto.randomBytes(16).toString("hex");
  db.run(
    "INSERT INTO invoice_comments (id, invoice_id, author_type, author_name, body) VALUES (?, ?, 'customer', ?, ?)",
    [id, invoiceId, customer.name, text],
  );

  const created = db
    .query(
      "SELECT id, author_type, author_name, body, created_at FROM invoice_comments WHERE id = ?",
    )
    .get(id);

  // Log the customer comment as an activity event so it shows up in the
  // staff notifications dropdown.
  const { logActivity } = await import("../services/activity.service");
  const inv = db.query("SELECT invoice_number FROM invoices WHERE id = ?").get(invoiceId) as {
    invoice_number: string;
  } | null;
  logActivity({
    user_id: null,
    user_name: customer.name,
    action: "portal_comment",
    resource_type: "invoice",
    resource_id: invoiceId,
    metadata: {
      invoice_number: inv?.invoice_number,
      preview: text.slice(0, 100),
    },
  });

  return c.json({ success: true, data: created }, 201);
});

export { publicRoutes };
