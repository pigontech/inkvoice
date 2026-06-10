import crypto from "node:crypto";
import { BUILTIN_TEMPLATES, readTemplateFile } from "../services/builtin-templates";
import { toIsoDate } from "../utils/date";
import { getEnv } from "../utils/env";
import { logger } from "../utils/logger";
import { hashPassword } from "../utils/password";
import { getDb } from "./connection";

function seedBuiltinTemplates(): void {
  const db = getDb();

  for (const tmpl of BUILTIN_TEMPLATES) {
    const html = readTemplateFile(tmpl.file);
    const existing = db
      .query("SELECT id, html_content FROM templates WHERE type = 'builtin' AND name = ?")
      .get(tmpl.name) as { id: string; html_content: string } | null;

    if (existing) {
      // Update HTML content if changed
      if (existing.html_content !== html) {
        db.run(
          "UPDATE templates SET html_content = ?, description = ?, updated_at = datetime('now') WHERE id = ?",
          [html, tmpl.description, existing.id],
        );
        logger.info({ template: tmpl.name }, "Updated builtin template");
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
      ["default_payment_terms", "Net 30"],
      ["default_notes", ""],
      ["locale", "en-US"],
      ["date_format", "YYYY-MM-DD"],
      ["number_format", "1,000.00"],
      ["fiscal_year_start_month", "1"],
      ["public_url", ""],
      ["pdf_qr_code_enabled", "false"],
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
    ];
    const stmt = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
    for (const [key, value] of newDefaults) stmt.run(key, value);
  }

  // Seed default tax definition
  const taxCount = db.query("SELECT COUNT(*) as count FROM tax_definitions").get() as {
    count: number;
  };
  if (taxCount.count === 0) {
    const id = crypto.randomBytes(16).toString("hex");
    db.run(
      "INSERT INTO tax_definitions (id, name, rate, description, is_default, is_active) VALUES (?, ?, ?, ?, 1, 1)",
      [id, "No Tax", 0, "No tax applied"],
    );
    logger.info("Default tax definition created.");
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
    },
    {
      name: "Berlin Consulting GmbH",
      email: "rechnungen@berlinconsulting.de",
      phone: "+49-30-5678",
      city: "Berlin",
      country: "DE",
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
      "INSERT INTO customers (id, name, email, phone, city, country) VALUES (?, ?, ?, ?, ?, ?)",
      [id, c.name, c.email, c.phone, c.city, c.country],
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

  logger.info(
    { customers: 5, products: 8, invoices: invoiceNum - 1, months: 12 },
    "Demo data seeded",
  );
}
