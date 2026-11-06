import crypto from "node:crypto";
import { BUNDLED_TEMPLATE_HISTORY } from "../services/builtin-template-history";
import {
  BUILTIN_TEMPLATES,
  hashTemplateHtml,
  readTemplateFile,
} from "../services/builtin-templates";
import { updateSettings } from "../services/settings.service";
import { toIsoDate } from "../utils/date";
import { getEnv } from "../utils/env";
import { logger } from "../utils/logger";
import { hashPassword } from "../utils/password";
import { getDb } from "./connection";

/**
 * Company profile for a public demo instance. A visitor signing in should land
 * on a populated dashboard, not the first-run wizard, so onboarding is marked
 * done and every field the dashboard, invoice list and PDFs render is filled
 * in with a plausible business.
 *
 * Currency and locale are pinned rather than left to the defaults because the
 * demo invoices in `seedDemoData` are USD.
 */
const DEMO_SETTINGS: Record<string, string> = {
  onboarding_completed: "true",
  company_name: "Northwind Studio",
  company_email: "billing@northwindstudio.com",
  company_phone: "+1-555-0142",
  company_address: "1200 Harbor View Drive\nSuite 300\nSeattle, WA 98101\nUnited States",
  company_street: "1200 Harbor View Drive, Suite 300",
  company_city: "Seattle",
  company_postal_code: "98101",
  company_country: "US",
  company_tax_id: "88-1234567",
  company_bank_details: "Cascade Bank\nAccount: 0042 1188 0031\nSWIFT: CASCUS33",
  currency: "USD",
  base_currency: "USD",
  locale: "en-US",
  default_notes: "Thank you for your business. Payment is due within 30 days.",
};

/** Whether `html` is exactly a version of built-in `name` that some release bundled. */
function isBundledVersion(name: string, html: string): boolean {
  const hash = hashTemplateHtml(html);
  if (BUNDLED_TEMPLATE_HISTORY[name]?.includes(hash)) return true;
  return !!getDb()
    .query("SELECT 1 FROM builtin_template_versions WHERE name = ? AND sha256 = ?")
    .get(name, hash);
}

/**
 * Brings the built-in templates in line with the bundled files on every boot.
 * Missing ones are inserted. An existing one moves to the bundled HTML only
 * while its HTML is a version some release bundled: the template editor saves
 * edits to built-ins, and an edit must survive upgrades. "Reset to default"
 * saves the bundled HTML, so a reset template counts as unedited again.
 */
function seedBuiltinTemplates(): void {
  const db = getDb();

  for (const tmpl of BUILTIN_TEMPLATES) {
    const html = readTemplateFile(tmpl.file);
    // Recorded even when the edit below is kept: a user who later resets the
    // template gets this HTML, and the next release must still recognize it.
    db.run("INSERT OR IGNORE INTO builtin_template_versions (name, sha256) VALUES (?, ?)", [
      tmpl.name,
      hashTemplateHtml(html),
    ]);
    const existing = db
      .query("SELECT id, html_content FROM templates WHERE type = 'builtin' AND name = ?")
      .get(tmpl.name) as { id: string; html_content: string } | null;

    if (existing) {
      if (existing.html_content !== html) {
        if (isBundledVersion(tmpl.name, existing.html_content)) {
          db.run(
            "UPDATE templates SET html_content = ?, updated_at = datetime('now') WHERE id = ?",
            [html, existing.id],
          );
          logger.info({ template: tmpl.name }, "Updated builtin template");
        } else {
          logger.info({ template: tmpl.name }, "Kept edited builtin template");
        }
      }
    } else {
      const id = crypto.randomBytes(16).toString("hex");
      db.run(
        "INSERT INTO templates (id, name, description, html_content, css_content, type, is_default) VALUES (?, ?, ?, ?, ?, 'builtin', ?)",
        [id, tmpl.name, tmpl.description, html, "", tmpl.isDefault ? 1 : 0],
      );
      logger.info({ template: tmpl.name }, "Created builtin template");
    }
  }

  // Remove old "Default" builtin template if it exists, reassigning any references
  const oldDefault = db
    .query("SELECT id FROM templates WHERE type = 'builtin' AND name = 'Default'")
    .get() as { id: string } | null;
  if (oldDefault) {
    const inkvoice = db
      .query("SELECT id FROM templates WHERE type = 'builtin' AND name = 'Inkvoice'")
      .get() as { id: string } | null;
    if (inkvoice) {
      db.run("UPDATE invoices SET template_id = ? WHERE template_id = ?", [
        inkvoice.id,
        oldDefault.id,
      ]);
      db.run("UPDATE quotes SET template_id = ? WHERE template_id = ?", [
        inkvoice.id,
        oldDefault.id,
      ]);
    }
    db.run("DELETE FROM templates WHERE id = ?", [oldDefault.id]);
    logger.info("Removed old 'Default' builtin template.");
  }

  // Ensure at least one template is default
  const hasDefault = db
    .query("SELECT COUNT(*) as count FROM templates WHERE is_default = 1")
    .get() as { count: number };
  if (hasDefault.count === 0) {
    const inkvoice = db
      .query("SELECT id FROM templates WHERE type = 'builtin' AND name = 'Inkvoice'")
      .get() as { id: string } | null;
    if (inkvoice) {
      db.run("UPDATE templates SET is_default = 1 WHERE id = ?", [inkvoice.id]);
    }
  }
}

export async function seed(): Promise<void> {
  const db = getDb();
  const env = getEnv();

  // Seed admin user if no users exist
  const userCount = db.query("SELECT COUNT(*) as count FROM users").get() as { count: number };
  if (userCount.count === 0) {
    const id = crypto.randomBytes(16).toString("hex");
    const passwordHash = await hashPassword(env.ADMIN_PASS);
    // Explicit role: the user_role migration upgrades pre-existing admins to
    // Owner, but on a fresh DB it runs before this seed — without this the
    // admin would fall back to the column default ('Viewer').
    db.run(
      "INSERT INTO users (id, username, password_hash, is_admin, is_active, role) VALUES (?, ?, ?, 1, 1, 'Owner')",
      [id, env.ADMIN_USER, passwordHash],
    );
    logger.info({ username: env.ADMIN_USER }, "Admin user created");
  }

  // Seed default settings
  const settingsCount = db.query("SELECT COUNT(*) as count FROM settings").get() as {
    count: number;
  };
  if (settingsCount.count === 0) {
    const defaults: [string, string][] = [
      ["company_name", "My Company"],
      ["company_email", ""],
      ["company_phone", ""],
      ["company_address", ""],
      ["company_tax_id", ""],
      ["company_logo", ""],
      ["currency", "USD"],
      ["base_currency", "USD"],
      ["exchange_rate_auto_fetch", "false"],
      ["tax_label", "Tax"],
      ["invoice_number_pattern", "INV-{YYYY}-{SEQ4}"],
      ["quote_number_pattern", "QT-{YYYY}-{SEQ4}"],
      ["credit_note_number_pattern", "CN-{YYYY}-{SEQ4}"],
      ["default_payment_terms", "Net 30"],
      ["default_notes", ""],
      ["locale", "en-US"],
      ["date_format", "YYYY-MM-DD"],
      ["number_format", "1,000.00"],
      ["fiscal_year_start_month", "1"],
      ["public_url", ""],
      ["pdf_qr_code_enabled", "false"],
      ["pdf_epc_qr_enabled", "false"],
      ["company_country", ""],
      ["einvoice_format", "zugferd"],
      ["einvoice_enabled", "false"],
      ["einvoice_attach_pdf", "true"],
      ["einvoice_kleinunternehmer", "false"],
      ["company_peppol_scheme", "0208"],
    ];
    const stmt = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
    for (const [key, value] of defaults) {
      stmt.run(key, value);
    }
    logger.info("Default settings created.");
  } else {
    // Backfill any newly-added default keys for existing installs.
    const newDefaults: [string, string][] = [
      ["public_url", ""],
      ["pdf_qr_code_enabled", "false"],
      ["pdf_epc_qr_enabled", "false"],
      ["company_country", ""],
      ["einvoice_format", "zugferd"],
      ["einvoice_enabled", "false"],
      ["einvoice_attach_pdf", "true"],
      ["einvoice_kleinunternehmer", "false"],
      ["company_peppol_scheme", "0208"],
      ["quote_number_pattern", "QT-{YYYY}-{SEQ4}"],
      ["credit_note_number_pattern", "CN-{YYYY}-{SEQ4}"],
    ];
    const stmt = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
    for (const [key, value] of newDefaults) stmt.run(key, value);
  }

  // Overlay the demo company profile. Applied on every seed rather than only on
  // a fresh database so that a restart always restores the showcase, including
  // on a demo that was first provisioned before this existed. Runs ahead of the
  // tax seeding below so that step sees `company_country`. Never reached by a
  // self-hosted install.
  if (env.DEMO_MODE) {
    updateSettings(DEMO_SETTINGS);
    logger.info({ company: DEMO_SETTINGS.company_name }, "Demo company profile applied");
  }

  // Seed default tax definition
  const taxCount = db.query("SELECT COUNT(*) as count FROM tax_definitions").get() as {
    count: number;
  };
  if (taxCount.count === 0) {
    // Prefer German VAT presets when the locale/country points at Germany,
    // otherwise fall back to a generic "No Tax" definition (existing behavior).
    const country = (
      (
        db.query("SELECT value FROM settings WHERE key = 'company_country'").get() as {
          value: string;
        } | null
      )?.value || ""
    ).toUpperCase();
    const locale = (
      (
        db.query("SELECT value FROM settings WHERE key = 'locale'").get() as {
          value: string;
        } | null
      )?.value || ""
    ).toLowerCase();
    const german = country === "DE" || locale.startsWith("de");

    if (german) {
      const presets: [string, number, string, string, number][] = [
        ["Umsatzsteuer 19% (Standard)", 19, "S", "Umsatzsteuer regelsatz", 1],
        ["Umsatzsteuer 7 % (ermäßigt)", 7, "AA", "Ermäßigter Steuersatz (z. B. Lebensmittel)", 0],
        ["Umsatzsteuer 0 %", 0, "Z", "Steuerfreie Lieferungen (z. B. innergemeinschaftlich)", 0],
        ["Steuerbefreit (§ 4 UStG)", 0, "E", "Steuerbefreite Leistungen", 0],
      ];
      const stmt = db.prepare(
        "INSERT INTO tax_definitions (id, name, rate, description, category_code, is_default, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)",
      );
      for (const [name, rate, code, desc, isDefault] of presets) {
        stmt.run(crypto.randomBytes(16).toString("hex"), name, rate, desc, code, isDefault);
      }
      logger.info("German VAT presets created (19 %/7 %/0 %/exempt).");
    } else {
      const id = crypto.randomBytes(16).toString("hex");
      db.run(
        "INSERT INTO tax_definitions (id, name, rate, description, is_default, is_active) VALUES (?, ?, ?, ?, 1, 1)",
        [id, "No Tax", 0, "No tax applied"],
      );
      logger.info("Default tax definition created.");
    }
  }

  // Seed product categories
  for (const name of ["service", "goods", "subscription", "other"]) {
    db.run(
      "INSERT OR IGNORE INTO product_categories (id, name, is_builtin) VALUES (lower(hex(randomblob(16))), ?, 1)",
      [name],
    );
  }

  // Seed product units
  for (const [name, symbol] of [
    ["piece", "pc"],
    ["hour", "hr"],
    ["day", "d"],
    ["kg", "kg"],
    ["meter", "m"],
    ["lump_sum", "ls"],
  ] as const) {
    db.run(
      "INSERT OR IGNORE INTO product_units (id, name, symbol, is_builtin) VALUES (lower(hex(randomblob(16))), ?, ?, 1)",
      [name, symbol],
    );
  }

  // Seed/sync builtin templates (runs every startup to keep templates up-to-date)
  seedBuiltinTemplates();
}

export function seedDemoData(): void {
  const db = getDb();

  // Demo customers
  const customers = [
    {
      name: "Acme Corp",
      email: "billing@acme.com",
      phone: "+1-555-0100",
      city: "New York",
      country: "US",
    },
    {
      name: "TechStart Inc",
      email: "finance@techstart.io",
      phone: "+1-555-0200",
      city: "San Francisco",
      country: "US",
    },
    {
      name: "Nordic Design AB",
      email: "info@nordicdesign.se",
      phone: "+46-8-1234",
      city: "Stockholm",
      country: "SE",
      einvoice_receiver_scheme: "0007",
      einvoice_receiver_id: "5566778899",
    },
    {
      name: "Berlin Consulting GmbH",
      email: "rechnungen@berlinconsulting.de",
      phone: "+49-30-5678",
      city: "Berlin",
      country: "DE",
      einvoice_receiver_scheme: "9930",
      einvoice_receiver_id: "DE123456789",
    },
    {
      name: "Tokyo Digital Co",
      email: "accounts@tokyodigital.jp",
      phone: "+81-3-9876",
      city: "Tokyo",
      country: "JP",
    },
  ];

  const customerIds: string[] = [];
  for (const c of customers) {
    const id = crypto.randomBytes(16).toString("hex");
    customerIds.push(id);
    db.run(
      `INSERT INTO customers (id, name, email, phone, city, country, einvoice_receiver_scheme, einvoice_receiver_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        c.name,
        c.email,
        c.phone,
        c.city,
        c.country,
        c.einvoice_receiver_scheme ?? null,
        c.einvoice_receiver_id ?? null,
      ],
    );
  }

  // Demo products
  const products = [
    { name: "Web Development", unit_price: 150, unit: "hour", category: "service" },
    { name: "UI/UX Design", unit_price: 120, unit: "hour", category: "service" },
    { name: "Server Hosting", unit_price: 49.99, unit: "piece", category: "subscription" },
    { name: "Domain Registration", unit_price: 14.99, unit: "piece", category: "subscription" },
    { name: "Logo Design", unit_price: 500, unit: "lump_sum", category: "service" },
    { name: "SEO Audit", unit_price: 350, unit: "lump_sum", category: "service" },
    { name: "Printed Business Cards", unit_price: 0.15, unit: "piece", category: "goods" },
    { name: "Consulting", unit_price: 200, unit: "hour", category: "service" },
  ];

  const productIds: string[] = [];
  for (const p of products) {
    const id = crypto.randomBytes(16).toString("hex");
    productIds.push(id);
    db.run("INSERT INTO products (id, name, unit_price, unit, category) VALUES (?, ?, ?, ?, ?)", [
      id,
      p.name,
      p.unit_price,
      p.unit,
      p.category,
    ]);
  }

  // Demo invoices — spread across 12 months for revenue chart
  // Each month gets 2-3 invoices with deterministic but varied data
  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
  let invoiceNum = 1;

  // Deterministic "random" based on index
  const seededValue = (i: number, max: number) => ((i * 7 + 3) % max) + 1;

  for (let monthOffset = 11; monthOffset >= 0; monthOffset--) {
    const invoicesThisMonth = monthOffset === 0 ? 3 : 2; // current month gets 3

    for (let j = 0; j < invoicesThisMonth; j++) {
      const invoiceId = crypto.randomBytes(16).toString("hex");
      const idx = invoiceNum - 1;
      const custIdx = idx % customerIds.length;

      // Issue date: random-ish day within the month
      const m = new Date(currentYear, currentMonth - monthOffset, 1);
      const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      const day = Math.min(seededValue(idx, 25), daysInMonth);
      const issueDate = new Date(m.getFullYear(), m.getMonth(), day);
      const dueDate = new Date(issueDate);
      dueDate.setDate(dueDate.getDate() + 30);

      // Status: older months mostly paid, recent months mixed
      let status: string;
      if (monthOffset >= 3) {
        status = "paid";
      } else if (monthOffset === 2) {
        status = j === 0 ? "paid" : "sent";
      } else if (monthOffset === 1) {
        status = j === 0 ? "paid" : "overdue";
      } else {
        status = ["draft", "sent", "paid"][j];
      }

      const invoiceNumber = `DEMO-${String(invoiceNum).padStart(4, "0")}`;

      // Pick 2-3 products per invoice
      const p1 = idx % productIds.length;
      const p2 = (idx + 3) % productIds.length;
      const qty1 = seededValue(idx, 8);
      const qty2 = seededValue(idx + 5, 4);
      const price1 = products[p1].unit_price;
      const price2 = products[p2].unit_price;
      const line1 = qty1 * price1;
      const line2 = qty2 * price2;
      const subtotal = line1 + line2;
      const total = subtotal;
      const amountPaid = status === "paid" ? total : 0;

      db.run(
        `INSERT INTO invoices (id, invoice_number, customer_id, status, issue_date, due_date, subtotal, total, amount_paid, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD')`,
        [
          invoiceId,
          invoiceNumber,
          customerIds[custIdx],
          status,
          toIsoDate(issueDate),
          toIsoDate(dueDate),
          subtotal,
          total,
          amountPaid,
        ],
      );

      // Invoice items
      const item1Id = crypto.randomBytes(16).toString("hex");
      db.run(
        "INSERT INTO invoice_items (id, invoice_id, product_id, description, quantity, unit_price, unit, line_total, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
        [
          item1Id,
          invoiceId,
          productIds[p1],
          products[p1].name,
          qty1,
          price1,
          products[p1].unit,
          line1,
        ],
      );
      const item2Id = crypto.randomBytes(16).toString("hex");
      db.run(
        "INSERT INTO invoice_items (id, invoice_id, product_id, description, quantity, unit_price, unit, line_total, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
        [
          item2Id,
          invoiceId,
          productIds[p2],
          products[p2].name,
          qty2,
          price2,
          products[p2].unit,
          line2,
        ],
      );

      invoiceNum++;
    }
  }

  // Demo time tracking: 2 projects, ~15 unbilled entries over the last ~8 days.
  const demoProjects = [
    { name: "Acme Corp Retainer", customerIndex: 0, default_rate: 150, billable: 1 },
    { name: "Internal R&D", customerIndex: null, default_rate: null, billable: 0 },
  ];
  const demoProjectIds: string[] = demoProjects.map((p) => {
    const id = crypto.randomBytes(16).toString("hex");
    db.run(
      `INSERT INTO tt_projects (id, name, customer_id, default_rate, billable)
       VALUES (?, ?, ?, ?, ?)`,
      [
        id,
        p.name,
        p.customerIndex === null ? null : customerIds[p.customerIndex],
        p.default_rate,
        p.billable,
      ],
    );
    return id;
  });

  const adminId = (
    db.query("SELECT id FROM users WHERE is_admin = 1 LIMIT 1").get() as { id: string }
  ).id;

  for (let i = 0; i < 15; i++) {
    const entryId = crypto.randomBytes(16).toString("hex");
    const projectIndex = i % demoProjects.length;
    const projectId = demoProjectIds[projectIndex];
    const project = demoProjects[projectIndex];
    const dayOffset = Math.floor(i / 2) + 1; // entries over the last ~8 days
    const startedAt = new Date();
    startedAt.setDate(startedAt.getDate() - dayOffset);
    startedAt.setHours(9 + (i % 6), 0, 0, 0);
    const durationSeconds = 1800 + seededValue(i, 8) * 900; // 45min to ~2.5h
    const endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
    db.run(
      `INSERT INTO tt_time_entries
         (id, project_id, description, started_at, ended_at, duration_seconds, rate, billable, is_billed, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        entryId,
        projectId,
        i % 3 === 0 ? "Implementation" : i % 3 === 1 ? "Review and planning" : "Support",
        startedAt.toISOString(),
        endedAt.toISOString(),
        durationSeconds,
        null,
        project.billable,
        adminId,
      ],
    );
  }

  logger.info(
    { customers: 5, products: 8, invoices: invoiceNum - 1, months: 12 },
    "Demo data seeded",
  );
}

/**
 * Seed the demo dataset at boot when there is nothing to show yet. Without this
 * a freshly provisioned demo container has the admin user but no invoices until
 * the first scheduled reset fires (24h by default).
 *
 * Guarded on an empty database so a restart never duplicates or clobbers what a
 * visitor has been doing, and on DEMO_MODE so self-hosted installs are
 * untouched. Returns whether it seeded.
 */
export function seedDemoDataIfEmpty(): boolean {
  if (!getEnv().DEMO_MODE) return false;

  const db = getDb();
  const { count } = db
    .query("SELECT (SELECT COUNT(*) FROM invoices) + (SELECT COUNT(*) FROM customers) AS count")
    .get() as { count: number };
  if (count > 0) return false;

  seedDemoData();
  return true;
}
