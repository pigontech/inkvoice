import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../database/connection";
import { seedDemoData } from "../database/seed";
import { isEmailConfigured, sendEmail, testConnection } from "../services/email.service";
import { resetDemoData } from "../services/scheduler";
import { getAllSettings, updateSettings } from "../services/settings.service";
import { getEnv } from "../utils/env";
import { isSepaIban, isValidBic, normalizeBic, normalizeIban } from "../utils/epc-qr";

const settings = new Hono();

// Internal catalog bookkeeping (cache blobs and fetch timestamps) lives in the
// settings table but is not user-facing; handing it to the frontend would have
// browsers cache potentially large JSON blobs. plugin_catalog_url is a real
// setting and stays visible.
const INTERNAL_SETTINGS = new Set([
  "plugin_catalog_cache",
  "plugin_catalog_synced_at",
  "plugin_catalog_votes",
  "plugin_catalog_votes_at",
  // Install-local secret behind the opaque vote identity. Never leaves the
  // server; handing it to a browser would let anyone mint another install's
  // vote identities.
  "plugin_vote_secret",
]);

function stripInternalSettings(data: Record<string, string>): Record<string, string> {
  const visible: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!INTERNAL_SETTINGS.has(key)) visible[key] = value;
  }
  return visible;
}

settings.get("/", async (c) => {
  const data = stripInternalSettings(getAllSettings());
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
  "company_street",
  "company_city",
  "company_postal_code",
  "company_country",
  "company_tax_id",
  "company_tax_number",
  "company_bank_details",
  "company_logo",
  "currency",
  "base_currency",
  "exchange_rate_auto_fetch",
  "public_url",
  "pdf_qr_code_enabled",
  "pdf_epc_qr_enabled",
  "company_iban",
  "company_bic",
  "company_account_holder",
  "tax_label",
  "invoice_number_pattern",
  "quote_number_pattern",
  "credit_note_number_pattern",
  "default_payment_terms",
  "default_notes",
  "locale",
  "email_from_name",
  "email_reply_to",
  "email_footer_text",
  "email_attach_pdf",
  "notify_on_invoice_view",
  "notify_on_auto_bill_failure",
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
  "einvoice_format",
  "einvoice_enabled",
  "einvoice_attach_pdf",
  "einvoice_kleinunternehmer",
  "einvoice_franchise_fr",
  "company_peppol_id",
  "company_peppol_scheme",
  "fiscal_year_start_month",
  "watermark_image",
  "watermark_enabled",
  "onboarding_completed",
  "peppol_enabled",
  "peppol_transport",
  "peppol_sender_scheme",
  "peppol_sender_id",
  "peppol_auto_send",
  "peppol_environment",
  "peppol_company_id",
  "france_enabled",
  "france_transport",
  "france_sender_siren",
  "plugin_catalog_url",
]);

// Number patterns with neither a sequence nor a random token render the same
// string every time, and invoice_number/quote_number are UNIQUE, so the second
// document would die on insert. An empty value is fine: it means "use the
// built-in default".
const NUMBER_PATTERN_SETTINGS = [
  "invoice_number_pattern",
  "quote_number_pattern",
  "credit_note_number_pattern",
];
const PATTERN_COUNTER_TOKEN = /\{SEQ\d*\}|\{RAND4\}/;

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

  // Only reject values that actually change, so an install that already stored
  // a bad pattern can still save the rest of its settings (and fix the pattern).
  const current = getAllSettings();
  for (const key of NUMBER_PATTERN_SETTINGS) {
    const value = filtered[key];
    if (value === undefined || value === current[key] || value === "") continue;
    if (!PATTERN_COUNTER_TOKEN.test(value)) {
      return c.json(
        {
          success: false,
          error: `Setting "${key}" must contain a {SEQ} or {RAND4} token, otherwise every document would get the same number`,
        },
        400,
      );
    }
  }

  // Bank details feed the EPC payment QR code, where a typo would send money to
  // the wrong account. Reject bad values at the door rather than silently
  // dropping the QR code off the invoice later. Both are stored normalized.
  if (filtered.company_iban !== undefined && filtered.company_iban.trim() !== "") {
    const iban = normalizeIban(filtered.company_iban);
    if (!isSepaIban(iban)) {
      return c.json(
        {
          success: false,
          error: `"${filtered.company_iban}" is not a valid SEPA IBAN`,
        },
        400,
      );
    }
    filtered.company_iban = iban;
  }
  if (filtered.company_bic !== undefined && filtered.company_bic.trim() !== "") {
    if (!isValidBic(filtered.company_bic)) {
      return c.json({ success: false, error: `"${filtered.company_bic}" is not a valid BIC` }, 400);
    }
    filtered.company_bic = normalizeBic(filtered.company_bic);
  }

  // The catalog source URL doubles as the documented off switch: an empty value
  // turns all catalog egress off, so it must be accepted as-is. Anything else
  // has to be an HTTPS URL the server can actually fetch, so a typo cannot
  // silently break the Plugins tab.
  //
  // HTTPS only, matching the policy every other server-side fetch of a
  // user-supplied URL follows (utils/ssrf-protection.ts). This value makes the
  // server issue a request, so it is reachable by whoever can write settings;
  // the fetch itself is additionally guarded (private ranges refused, redirects
  // re-validated, body capped) in utils/safe-fetch.ts. An overlay that lets
  // untrusted tenants administer their own settings must block this key
  // outright rather than rely on those guards.
  if (filtered.plugin_catalog_url !== undefined && filtered.plugin_catalog_url !== "") {
    const url = filtered.plugin_catalog_url;
    if (url.length > 2048) {
      return c.json(
        {
          success: false,
          error: `Setting "plugin_catalog_url" must be at most 2048 characters`,
        },
        400,
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return c.json(
        { success: false, error: `Setting "plugin_catalog_url" must be a valid https URL` },
        400,
      );
    }
    if (parsed.protocol !== "https:") {
      return c.json(
        { success: false, error: `Setting "plugin_catalog_url" must be a valid https URL` },
        400,
      );
    }
  }

  updateSettings(filtered);
  const data = stripInternalSettings(getAllSettings());
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
