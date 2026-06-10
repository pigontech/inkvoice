import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../database/connection";
import { seedDemoData } from "../database/seed";
import { isEmailConfigured, sendEmail, testConnection } from "../services/email.service";
import { resetDemoData } from "../services/scheduler";
import { getAllSettings, updateSettings } from "../services/settings.service";
import { getEnv } from "../utils/env";

const settings = new Hono();

settings.get("/", async (c) => {
  const data = getAllSettings();
  const emailConfigured = await isEmailConfigured();
  return c.json({
    success: true,
    data: {
      ...data,
      email_configured: emailConfigured ? "true" : "false",
      demo_mode: getEnv().DEMO_MODE ? "true" : "false",
    },
  });
});

const ALLOWED_SETTINGS = new Set([
  "company_name",
  "company_email",
  "company_phone",
  "company_address",
  "company_tax_id",
  "company_bank_details",
  "company_logo",
  "currency",
  "tax_label",
  "invoice_number_pattern",
  "default_payment_terms",
  "default_notes",
  "locale",
  "email_from_name",
  "email_reply_to",
  "email_footer_text",
  "email_attach_pdf",
  "notify_on_invoice_view",
  "invoice_email_subject",
  "invoice_email_body",
  "late_fee_enabled",
  "late_fee_type",
  "late_fee_value",
  "late_fee_grace_days",
  "late_fee_frequency",
  "stripe_enabled",
  "paypal_enabled",
  "accent_color",
  "date_format",
  "number_format",
  "tax_rounding_mode",
  "default_tax_rate",
  "prices_include_tax",
  "peppol_endpoint_id",
  "peppol_scheme_id",
  "default_xml_profile",
  "pdf_embed_xml",
  "fiscal_year_start_month",
  "watermark_image",
  "watermark_enabled",
  "onboarding_completed",
]);

settings.put("/", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = z.record(z.unknown()).safeParse(raw);
  if (!parsed.success || raw === null || typeof raw !== "object") {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (!ALLOWED_SETTINGS.has(k)) continue;
    if (typeof v !== "string") {
      return c.json({ success: false, error: `Setting "${k}" must be a string` }, 400);
    }
    filtered[k] = v;
  }

  updateSettings(filtered);
  const data = getAllSettings();
  const emailConfigured = await isEmailConfigured();
  return c.json({
    success: true,
    data: { ...data, email_configured: emailConfigured ? "true" : "false" },
  });
});

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/svg+xml", "image/webp"];
const MAX_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB

async function readImageUpload(
  file: unknown,
): Promise<{ ok: true; dataUri: string } | { ok: false; status: 400; error: string }> {
  if (!file || !(file instanceof File)) {
    return { ok: false, status: 400, error: "No file provided" };
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return { ok: false, status: 400, error: "Image must be under 2MB" };
  }
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return {
      ok: false,
      status: 400,
      error: "Invalid image type. Allowed: PNG, JPEG, GIF, SVG, WebP",
    };
  }
  const buffer = await file.arrayBuffer();
  return {
    ok: true,
    dataUri: `data:${file.type};base64,${Buffer.from(buffer).toString("base64")}`,
  };
}

settings.post("/logo", async (c) => {
  const body = await c.req.parseBody();
  const result = await readImageUpload(body.logo);
  if (!result.ok) return c.json({ success: false, error: result.error }, result.status);
  updateSettings({ company_logo: result.dataUri });
  return c.json({ success: true, data: { logo: result.dataUri } });
});

settings.post("/watermark", async (c) => {
  const body = await c.req.parseBody();
  const result = await readImageUpload(body.watermark);
  if (!result.ok) return c.json({ success: false, error: result.error }, result.status);
  updateSettings({ watermark_image: result.dataUri });
  return c.json({ success: true, data: { watermark: result.dataUri } });
});

settings.post("/test-email", async (c) => {
  const body = await c.req.json();
  const to = body.to;
  if (!to) return c.json({ success: false, error: "Recipient email is required" }, 400);

  const verifyResult = await testConnection();
  if (!verifyResult.success) {
    return c.json({ success: false, error: verifyResult.error }, 400);
  }

  const result = await sendEmail({
    to,
    subject: "Inkvoice — SMTP Test",
    html: "<p>Your SMTP settings are working correctly.</p>",
    text: "Your SMTP settings are working correctly.",
  });

  if (!result.success) {
    return c.json({ success: false, error: result.error }, 400);
  }
  return c.json({ success: true, data: { message: "Test email sent" } });
});

// Reset the database to seeded demo state. Only available when DEMO_MODE=true
// so this can never wipe a real customer's data.
settings.post("/reset-demo", async (c) => {
  if (!getEnv().DEMO_MODE) {
    return c.json({ success: false, error: "Demo mode is not enabled" }, 403);
  }
  await resetDemoData();
  return c.json({ success: true, data: { message: "Demo data reset" } });
});

// Populate the current database with sample customers/products/invoices.
// Refuses if the database already contains invoices so it can't clobber real data.
settings.post("/seed-sample-data", (c) => {
  const db = getDb();
  const existing = db.query("SELECT COUNT(*) as count FROM invoices").get() as { count: number };
  if (existing.count > 0) {
    return c.json(
      { success: false, error: "Cannot load sample data into a non-empty database" },
      400,
    );
  }
  seedDemoData();
  const customers = db.query("SELECT COUNT(*) as count FROM customers").get() as { count: number };
  const products = db.query("SELECT COUNT(*) as count FROM products").get() as { count: number };
  const invoices = db.query("SELECT COUNT(*) as count FROM invoices").get() as { count: number };
  return c.json({
    success: true,
    data: {
      customers: customers.count,
      products: products.count,
      invoices: invoices.count,
    },
  });
});

export { settings };
