import type { Database } from "bun:sqlite";
import { copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { getEnv } from "../utils/env";
import { logger } from "../utils/logger";
import { getDb } from "./connection";

interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

// Numbered migrations applied in order. Each runs inside a transaction; the
// schema_migrations row is inserted in the same transaction. Re-running the
// app is a no-op for already-applied versions.
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS customers (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          address_line1 TEXT,
          address_line2 TEXT,
          city TEXT,
          state TEXT,
          postal_code TEXT,
          country TEXT,
          tax_id TEXT,
          notes TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS tax_definitions (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          name TEXT NOT NULL,
          rate REAL NOT NULL,
          description TEXT,
          is_default INTEGER DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS products (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          name TEXT NOT NULL,
          description TEXT,
          sku TEXT,
          unit_price REAL NOT NULL DEFAULT 0,
          unit TEXT DEFAULT 'piece',
          category TEXT DEFAULT 'service',
          tax_id TEXT REFERENCES tax_definitions(id),
          is_active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS templates (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          name TEXT NOT NULL,
          description TEXT,
          html_content TEXT NOT NULL,
          css_content TEXT,
          type TEXT DEFAULT 'custom',
          is_default INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS invoices (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          invoice_number TEXT NOT NULL UNIQUE,
          customer_id TEXT NOT NULL REFERENCES customers(id),
          status TEXT DEFAULT 'draft',
          type TEXT DEFAULT 'invoice',
          issue_date TEXT NOT NULL,
          due_date TEXT,
          subtotal REAL DEFAULT 0,
          tax_total REAL DEFAULT 0,
          discount_type TEXT,
          discount_value REAL DEFAULT 0,
          discount_amount REAL DEFAULT 0,
          total REAL DEFAULT 0,
          amount_paid REAL DEFAULT 0,
          notes TEXT,
          payment_terms TEXT,
          currency TEXT DEFAULT 'USD',
          share_token TEXT UNIQUE,
          is_published INTEGER DEFAULT 0,
          template_id TEXT REFERENCES templates(id),
          reference_invoice_id TEXT REFERENCES invoices(id),
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          deleted_at TEXT DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS invoice_items (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          product_id TEXT REFERENCES products(id),
          description TEXT NOT NULL,
          quantity REAL NOT NULL DEFAULT 1,
          unit_price REAL NOT NULL DEFAULT 0,
          unit TEXT DEFAULT 'piece',
          tax_id TEXT REFERENCES tax_definitions(id),
          tax_rate REAL DEFAULT 0,
          tax_amount REAL DEFAULT 0,
          line_total REAL DEFAULT 0,
          sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          username TEXT NOT NULL UNIQUE,
          email TEXT,
          display_name TEXT,
          password_hash TEXT NOT NULL,
          is_admin INTEGER DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS user_permissions (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          resource TEXT NOT NULL,
          action TEXT NOT NULL,
          UNIQUE(user_id, resource, action)
        );

        CREATE TABLE IF NOT EXISTS recurring_invoices (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          customer_id TEXT NOT NULL REFERENCES customers(id),
          template_invoice_id TEXT NOT NULL REFERENCES invoices(id),
          frequency TEXT NOT NULL,
          interval_value INTEGER DEFAULT 1,
          next_run_date TEXT NOT NULL,
          end_date TEXT,
          status TEXT DEFAULT 'active',
          auto_send INTEGER DEFAULT 0,
          total_generated INTEGER DEFAULT 0,
          last_generated_at TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS payments (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          invoice_id TEXT NOT NULL REFERENCES invoices(id),
          amount REAL NOT NULL,
          payment_date TEXT NOT NULL,
          method TEXT DEFAULT 'bank_transfer',
          reference TEXT,
          notes TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS activity_log (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          user_id TEXT REFERENCES users(id),
          user_name TEXT,
          action TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS reminder_rules (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          name TEXT NOT NULL,
          days_offset INTEGER NOT NULL,
          type TEXT NOT NULL,
          email_subject TEXT NOT NULL,
          email_body TEXT NOT NULL,
          is_active INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS reminder_log (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          invoice_id TEXT NOT NULL REFERENCES invoices(id),
          rule_id TEXT NOT NULL REFERENCES reminder_rules(id),
          sent_at TEXT DEFAULT (datetime('now')),
          status TEXT DEFAULT 'sent',
          error_message TEXT,
          UNIQUE(invoice_id, rule_id)
        );

        CREATE TABLE IF NOT EXISTS quotes (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          quote_number TEXT NOT NULL UNIQUE,
          customer_id TEXT NOT NULL REFERENCES customers(id),
          status TEXT DEFAULT 'draft',
          issue_date TEXT NOT NULL,
          valid_until TEXT,
          subtotal REAL DEFAULT 0,
          tax_total REAL DEFAULT 0,
          discount_type TEXT,
          discount_value REAL DEFAULT 0,
          discount_amount REAL DEFAULT 0,
          total REAL DEFAULT 0,
          notes TEXT,
          currency TEXT DEFAULT 'USD',
          share_token TEXT UNIQUE,
          is_published INTEGER DEFAULT 0,
          converted_invoice_id TEXT REFERENCES invoices(id),
          template_id TEXT REFERENCES templates(id),
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          deleted_at TEXT DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS quote_items (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
          product_id TEXT REFERENCES products(id),
          description TEXT NOT NULL,
          quantity REAL NOT NULL DEFAULT 1,
          unit_price REAL NOT NULL DEFAULT 0,
          unit TEXT DEFAULT 'piece',
          tax_id TEXT REFERENCES tax_definitions(id),
          tax_rate REAL DEFAULT 0,
          tax_amount REAL DEFAULT 0,
          line_total REAL DEFAULT 0,
          sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS feedback (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          message TEXT NOT NULL,
          page_url TEXT,
          user_agent TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number);
        CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
        CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
        CREATE INDEX IF NOT EXISTS idx_invoices_share_token ON invoices(share_token);
        CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date);
        CREATE INDEX IF NOT EXISTS idx_invoices_type ON invoices(type);
        CREATE INDEX IF NOT EXISTS idx_invoices_reference ON invoices(reference_invoice_id);
        CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
        CREATE INDEX IF NOT EXISTS idx_invoice_items_product ON invoice_items(product_id);
        CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
        CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
        CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);
        CREATE INDEX IF NOT EXISTS idx_tax_definitions_active ON tax_definitions(is_active);
        CREATE INDEX IF NOT EXISTS idx_recurring_status ON recurring_invoices(status);
        CREATE INDEX IF NOT EXISTS idx_recurring_next_run ON recurring_invoices(next_run_date);
        CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
        CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
        CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
        CREATE INDEX IF NOT EXISTS idx_activity_log_resource ON activity_log(resource_type, resource_id);
        CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
        CREATE INDEX IF NOT EXISTS idx_reminder_log_invoice ON reminder_log(invoice_id);
        CREATE INDEX IF NOT EXISTS idx_quotes_number ON quotes(quote_number);
        CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes(customer_id);
        CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
        CREATE INDEX IF NOT EXISTS idx_quotes_share_token ON quotes(share_token);
        CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);
        CREATE INDEX IF NOT EXISTS idx_quote_items_product ON quote_items(product_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
      `);
    },
  },
  {
    version: 2,
    name: "invoice_quote_locale",
    up: (db) => {
      addColumnIfMissing(db, "invoices", "locale", "TEXT");
      addColumnIfMissing(db, "quotes", "locale", "TEXT");
      addColumnIfMissing(db, "customers", "language", "TEXT");
    },
  },
  {
    version: 3,
    name: "tax_category_codes",
    up: (db) => {
      addColumnIfMissing(db, "tax_definitions", "category_code", "TEXT DEFAULT 'S'");
      addColumnIfMissing(db, "tax_definitions", "vendor_tax_id", "TEXT");
      db.exec(`
        CREATE TABLE IF NOT EXISTS invoice_taxes (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          tax_definition_id TEXT,
          tax_name TEXT NOT NULL,
          tax_rate REAL NOT NULL,
          category_code TEXT DEFAULT 'S',
          taxable_amount REAL NOT NULL DEFAULT 0,
          tax_amount REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_invoice_taxes_invoice ON invoice_taxes(invoice_id);

        CREATE TABLE IF NOT EXISTS invoice_item_taxes (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          invoice_item_id TEXT NOT NULL REFERENCES invoice_items(id) ON DELETE CASCADE,
          tax_definition_id TEXT,
          tax_name TEXT NOT NULL,
          tax_rate REAL NOT NULL,
          category_code TEXT DEFAULT 'S',
          taxable_amount REAL NOT NULL DEFAULT 0,
          tax_amount REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_invoice_item_taxes_item ON invoice_item_taxes(invoice_item_id);
      `);
    },
  },
  {
    version: 4,
    name: "prices_include_tax",
    up: (db) => {
      addColumnIfMissing(db, "invoices", "prices_include_tax", "INTEGER DEFAULT 0");
      addColumnIfMissing(db, "quotes", "prices_include_tax", "INTEGER DEFAULT 0");
    },
  },
  {
    version: 5,
    name: "product_categories_units",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS product_categories (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          name TEXT NOT NULL UNIQUE,
          is_builtin INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS product_units (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          name TEXT NOT NULL UNIQUE,
          symbol TEXT,
          is_builtin INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
    },
  },
  {
    version: 6,
    name: "template_install_metadata",
    up: (db) => {
      const has = (col: string) =>
        (
          db
            .query(`SELECT COUNT(*) as cnt FROM pragma_table_info('templates') WHERE name = ?`)
            .get(col) as { cnt: number }
        ).cnt > 0;
      if (!has("source_url")) {
        db.exec("ALTER TABLE templates ADD COLUMN source_url TEXT");
        db.exec("ALTER TABLE templates ADD COLUMN manifest_url TEXT");
        db.exec("ALTER TABLE templates ADD COLUMN sha256_hash TEXT");
        db.exec("ALTER TABLE templates ADD COLUMN file_size INTEGER");
        db.exec("ALTER TABLE templates ADD COLUMN installed_at TEXT");
        db.exec("UPDATE templates SET type = 'local' WHERE type = 'custom'");
      }
    },
  },
  {
    version: 7,
    name: "customer_default_template",
    up: (db) => {
      addColumnIfMissing(db, "customers", "default_template_id", "TEXT REFERENCES templates(id)");
    },
  },
  {
    version: 8,
    name: "customer_portal",
    up: (db) => {
      addColumnIfMissing(db, "customers", "portal_enabled", "INTEGER DEFAULT 0");
      db.exec(`
        CREATE TABLE IF NOT EXISTS portal_tokens (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          customer_id TEXT NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
          token TEXT NOT NULL UNIQUE,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_portal_tokens_token ON portal_tokens(token);
        CREATE INDEX IF NOT EXISTS idx_portal_tokens_customer ON portal_tokens(customer_id);

        CREATE TABLE IF NOT EXISTS invoice_comments (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          author_type TEXT NOT NULL CHECK(author_type IN ('customer', 'staff')),
          author_name TEXT,
          body TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_invoice_comments_invoice ON invoice_comments(invoice_id);
      `);
    },
  },
  {
    version: 9,
    name: "outgoing_webhooks",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS outgoing_webhooks (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          events TEXT NOT NULL DEFAULT '[]',
          preset TEXT DEFAULT 'generic',
          is_active INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS webhook_deliveries (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          webhook_id TEXT NOT NULL REFERENCES outgoing_webhooks(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL,
          payload TEXT,
          status_code INTEGER,
          response_body TEXT,
          error_message TEXT,
          attempt_count INTEGER DEFAULT 1,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created ON webhook_deliveries(created_at);
      `);
    },
  },
  {
    version: 10,
    name: "search_fts",
    up: (db) => {
      const ftsExists = db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name='search_index'")
        .get() as { name: string } | null;
      if (!ftsExists) {
        try {
          db.exec(`
            CREATE VIRTUAL TABLE search_index USING fts5(
              kind UNINDEXED,
              id UNINDEXED,
              body,
              tokenize = 'porter unicode61'
            );
          `);
        } catch (err) {
          logger.warn({ err }, "FTS5 unavailable — full-text search will be disabled");
          return;
        }
      }

      db.exec(`
        CREATE TRIGGER IF NOT EXISTS customers_fts_insert AFTER INSERT ON customers BEGIN
          INSERT INTO search_index(kind, id, body)
          VALUES ('customer', NEW.id, COALESCE(NEW.name, '') || ' ' || COALESCE(NEW.email, '') || ' ' || COALESCE(NEW.notes, ''));
        END;
        CREATE TRIGGER IF NOT EXISTS customers_fts_delete AFTER DELETE ON customers BEGIN
          DELETE FROM search_index WHERE kind = 'customer' AND id = OLD.id;
        END;
        CREATE TRIGGER IF NOT EXISTS customers_fts_update AFTER UPDATE ON customers BEGIN
          DELETE FROM search_index WHERE kind = 'customer' AND id = OLD.id;
          INSERT INTO search_index(kind, id, body)
          VALUES ('customer', NEW.id, COALESCE(NEW.name, '') || ' ' || COALESCE(NEW.email, '') || ' ' || COALESCE(NEW.notes, ''));
        END;

        CREATE TRIGGER IF NOT EXISTS products_fts_insert AFTER INSERT ON products BEGIN
          INSERT INTO search_index(kind, id, body)
          VALUES ('product', NEW.id, COALESCE(NEW.name, '') || ' ' || COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.sku, ''));
        END;
        CREATE TRIGGER IF NOT EXISTS products_fts_delete AFTER DELETE ON products BEGIN
          DELETE FROM search_index WHERE kind = 'product' AND id = OLD.id;
        END;
        CREATE TRIGGER IF NOT EXISTS products_fts_update AFTER UPDATE ON products BEGIN
          DELETE FROM search_index WHERE kind = 'product' AND id = OLD.id;
          INSERT INTO search_index(kind, id, body)
          VALUES ('product', NEW.id, COALESCE(NEW.name, '') || ' ' || COALESCE(NEW.description, '') || ' ' || COALESCE(NEW.sku, ''));
        END;

        CREATE TRIGGER IF NOT EXISTS invoices_fts_insert AFTER INSERT ON invoices BEGIN
          INSERT INTO search_index(kind, id, body)
          VALUES ('invoice', NEW.id, COALESCE(NEW.invoice_number, '') || ' ' || COALESCE(NEW.notes, '') || ' ' || COALESCE(NEW.payment_terms, ''));
        END;
        CREATE TRIGGER IF NOT EXISTS invoices_fts_delete AFTER DELETE ON invoices BEGIN
          DELETE FROM search_index WHERE kind = 'invoice' AND id = OLD.id;
        END;
        CREATE TRIGGER IF NOT EXISTS invoices_fts_update AFTER UPDATE ON invoices BEGIN
          DELETE FROM search_index WHERE kind = 'invoice' AND id = OLD.id;
          INSERT INTO search_index(kind, id, body)
          VALUES ('invoice', NEW.id, COALESCE(NEW.invoice_number, '') || ' ' || COALESCE(NEW.notes, '') || ' ' || COALESCE(NEW.payment_terms, ''));
        END;
      `);

      const ftsCount = db.query("SELECT COUNT(*) as c FROM search_index").get() as { c: number };
      if (ftsCount.c === 0) {
        db.transaction(() => {
          db.exec(`
            INSERT INTO search_index(kind, id, body)
              SELECT 'customer', id, COALESCE(name, '') || ' ' || COALESCE(email, '') || ' ' || COALESCE(notes, '')
              FROM customers;
            INSERT INTO search_index(kind, id, body)
              SELECT 'product', id, COALESCE(name, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(sku, '')
              FROM products;
            INSERT INTO search_index(kind, id, body)
              SELECT 'invoice', id, COALESCE(invoice_number, '') || ' ' || COALESCE(notes, '') || ' ' || COALESCE(payment_terms, '')
              FROM invoices WHERE deleted_at IS NULL;
          `);
        })();
      }
    },
  },
  {
    version: 11,
    name: "password_reset_tokens",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL,
          consumed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);
        CREATE INDEX IF NOT EXISTS idx_password_reset_expires ON password_reset_tokens(expires_at);
      `);
    },
  },
  {
    version: 12,
    name: "user_role",
    up: (db) => {
      // Default Viewer so accidental INSERTs without role specified are
      // restricted by default. Existing admins are upgraded to Owner below.
      addColumnIfMissing(db, "users", "role", "TEXT DEFAULT 'Viewer'");
      db.exec(`UPDATE users SET role = 'Owner' WHERE is_admin = 1`);
    },
  },
  {
    version: 13,
    name: "expenses",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS expenses (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          vendor TEXT,
          category TEXT,
          description TEXT,
          expense_date TEXT NOT NULL,
          amount REAL NOT NULL DEFAULT 0,
          tax_id TEXT REFERENCES tax_definitions(id),
          tax_rate REAL DEFAULT 0,
          tax_amount REAL DEFAULT 0,
          total REAL NOT NULL DEFAULT 0,
          currency TEXT DEFAULT 'USD',
          receipt_reference TEXT,
          customer_id TEXT REFERENCES customers(id),
          is_billable INTEGER DEFAULT 0,
          billed_invoice_id TEXT REFERENCES invoices(id),
          notes TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
        CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
        CREATE INDEX IF NOT EXISTS idx_expenses_customer ON expenses(customer_id);
        CREATE INDEX IF NOT EXISTS idx_expenses_billable ON expenses(is_billable);
      `);
    },
  },
  {
    version: 14,
    name: "multi_currency",
    up: (db) => {
      // exchange_rate = base-currency units per 1 unit of the row's own
      // currency, frozen at issue time. 1 means same-as-base (the default for
      // all existing rows, which is correct for single-currency users).
      addColumnIfMissing(db, "invoices", "exchange_rate", "REAL DEFAULT 1");
      addColumnIfMissing(db, "expenses", "exchange_rate", "REAL DEFAULT 1");
      // Per-customer default currency (null = fall back to business currency).
      addColumnIfMissing(db, "customers", "currency", "TEXT");
    },
  },
  {
    version: 15,
    name: "api_tokens",
    up: (db) => {
      // Long-lived bearer tokens for the public REST API (Zapier/Make and other
      // integrations). Only the SHA-256 hash of the token is stored; the plain
      // token is shown once at creation time. `scopes` is a JSON array of
      // "resource:action" strings (empty array = full access as the owner).
      db.exec(`
        CREATE TABLE IF NOT EXISTS api_tokens (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          token_prefix TEXT NOT NULL,
          scopes TEXT NOT NULL DEFAULT '[]',
          last_used_at TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
        CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
      `);
    },
  },
  {
    version: 16,
    name: "invoice_view_tracking",
    up: (db) => {
      // Stamped when a client opens the public share link. Kept separate from
      // updated_at so a view never re-sorts lists or trips updated_since polling.
      addColumnIfMissing(db, "invoices", "first_viewed_at", "TEXT");
      addColumnIfMissing(db, "invoices", "last_viewed_at", "TEXT");
    },
  },
];

export const LATEST_MIGRATION_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

function addColumnIfMissing(db: Database, table: string, column: string, ddl: string): void {
  const has = db
    .query(`SELECT COUNT(*) as cnt FROM pragma_table_info(?) WHERE name = ?`)
    .get(table, column) as { cnt: number };
  if (!has.cnt) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

function tableExists(db: Database, name: string): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { name: string } | null;
  return !!row;
}

// Existing pre-versioning DBs already have all current columns; we mark every
// known migration as applied so future boots only run new versions.
function backfillExistingDb(db: Database): void {
  for (const m of MIGRATIONS) {
    db.run(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`, [
      m.version,
      m.name,
      "backfilled",
    ]);
  }
}

function backupDatabase(): void {
  const dbPath = getEnv().DATABASE_PATH;

  if (!existsSync(dbPath)) {
    return;
  }

  const stats = statSync(dbPath);
  if (stats.size === 0) {
    return;
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\.\d{3}Z$/, "");
  const backupPath = `${dbPath}.backup-${timestamp}`;
  copyFileSync(dbPath, backupPath);
  logger.info({ backupPath }, "Database backup created");

  const dir = dirname(dbPath);
  const dbName = basename(dbPath);
  const backupPrefix = `${dbName}.backup-`;

  const backups = readdirSync(dir)
    .filter((f) => f.startsWith(backupPrefix))
    .sort()
    .map((f) => join(dir, f));

  if (backups.length > 5) {
    const toDelete = backups.slice(0, backups.length - 5);
    for (const old of toDelete) {
      unlinkSync(old);
    }
  }
}

// Extension point: a deployment that migrates many databases (and manages its
// own backups) can turn off the pre-migration backup copy — env.DATABASE_PATH
// would not match the database actually being migrated.
let migrationBackupsEnabled = true;

export function setMigrationBackupsEnabled(enabled: boolean): void {
  migrationBackupsEnabled = enabled;
}

export function runMigrations(): void {
  if (migrationBackupsEnabled) {
    backupDatabase();
  }

  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const appliedRow = db
    .query("SELECT MAX(version) as v, COUNT(*) as cnt FROM schema_migrations")
    .get() as { v: number | null; cnt: number };

  // First run on a pre-versioning DB: customers/etc already exist, mark all
  // migrations as applied without re-running.
  if (appliedRow.cnt === 0 && tableExists(db, "customers")) {
    db.transaction(() => backfillExistingDb(db))();
    logger.info(
      { version: LATEST_MIGRATION_VERSION },
      "Schema migrations backfilled (existing DB)",
    );
    return;
  }

  const currentVersion = appliedRow.v ?? 0;
  const pending = MIGRATIONS.filter((m) => m.version > currentVersion);

  if (pending.length === 0) {
    logger.info({ version: currentVersion }, "Schema migrations up to date");
    return;
  }

  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      db.run(`INSERT INTO schema_migrations (version, name) VALUES (?, ?)`, [
        migration.version,
        migration.name,
      ]);
    })();
    logger.info({ version: migration.version, name: migration.name }, "Applied migration");
  }
}
