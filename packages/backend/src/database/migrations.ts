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
  {
    version: 17,
    name: "portal_token_expiry",
    up: (db) => {
      // NULL = no expiry (self-hosted portal links stay permanent). Callers
      // that stamp a TTL at generation time get expired tokens rejected by
      // the public portal routes.
      addColumnIfMissing(db, "portal_tokens", "expires_at", "TEXT");
    },
  },
  {
    version: 18,
    name: "einvoice_germany",
    up: (db) => {
      // Per-customer e-invoice data (Germany: Leitweg-ID for B2G, receiver id
      // for PEPPOL/e-invoice addressing, per-customer format override).
      addColumnIfMissing(db, "customers", "einvoice_format", "TEXT");
      addColumnIfMissing(db, "customers", "leitweg_id", "TEXT");
      addColumnIfMissing(db, "customers", "einvoice_receiver_id", "TEXT");
      addColumnIfMissing(db, "customers", "einvoice_receiver_scheme", "TEXT");
      addColumnIfMissing(db, "customers", "tax_number", "TEXT");

      // Revision-safe outbox of emitted e-invoices. The XML is always stored
      // (that is the legal e-invoice); the PDF/A-3 hybrid is optional but kept
      // so archiving matches what was actually delivered.
      db.exec(`
        CREATE TABLE IF NOT EXISTS einvoice_documents (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          format TEXT NOT NULL,             -- zugferd | xrechnung-ubl | xrechnung-cii | peppol | pdf
          xml_content TEXT,
          pdf_content BLOB,
          hash TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_einvoice_documents_invoice ON einvoice_documents(invoice_id);
        CREATE INDEX IF NOT EXISTS idx_einvoice_documents_created ON einvoice_documents(created_at);

        CREATE TABLE IF NOT EXISTS einvoice_inbox (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          document_number TEXT,
          issue_date TEXT,
          supplier_name TEXT,
          supplier_vat_id TEXT,
          total REAL,
          currency TEXT,
          file_name TEXT,
          content_type TEXT,
          raw_content BLOB NOT NULL,
          raw_hash TEXT NOT NULL,
          status TEXT DEFAULT 'inbox',      -- inbox | processed | archived
          customer_id TEXT REFERENCES customers(id),
          parse_status TEXT DEFAULT 'pending', -- pending | ok | error
          parse_error TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          processed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_einvoice_inbox_created ON einvoice_inbox(created_at);
        CREATE INDEX IF NOT EXISTS idx_einvoice_inbox_status ON einvoice_inbox(status);
      `);
    },
  },
  {
    version: 19,
    name: "late_fees",
    up: (db) => {
      // Tracks automatically-applied late payment fees. `late_fee_next_date`
      // gates a "monthly" frequency: a fee is re-applied only once that date is
      // reached while the invoice is still overdue. Flipping `late_fee_blocked`
      // to 1 stops re-application for the "once" frequency.
      addColumnIfMissing(db, "invoices", "late_fee_blocked", "INTEGER DEFAULT 0");
      addColumnIfMissing(db, "invoices", "late_fee_next_date", "TEXT");
    },
  },
  {
    version: 20,
    name: "quote_instalments",
    up: (db) => {
      // Records invoices generated from a quote split into instalments. One
      // row per instalment invoice; the quote itself is marked 'converted'.
      db.exec(`
        CREATE TABLE IF NOT EXISTS quote_instalments (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
          invoice_id TEXT NOT NULL REFERENCES invoices(id),
          seq INTEGER NOT NULL,
          percent REAL NOT NULL,
          label TEXT NOT NULL,
          due_date TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_quote_instalments_quote ON quote_instalments(quote_id);
      `);
    },
  },
  {
    version: 21,
    name: "cash_discount",
    up: (db) => {
      // Optional early-payment (cash) discount offered on an invoice. When
      // `cash_discount_days > 0` the customer may pay a reduced amount if they
      // settle within that many days of the issue date. `cash_discount_applied`
      // tracks how much was actually given up so the invoice settles as paid.
      addColumnIfMissing(db, "invoices", "cash_discount_type", "TEXT");
      addColumnIfMissing(db, "invoices", "cash_discount_value", "REAL DEFAULT 0");
      addColumnIfMissing(db, "invoices", "cash_discount_days", "INTEGER DEFAULT 0");
      addColumnIfMissing(db, "invoices", "cash_discount_applied", "REAL DEFAULT 0");
    },
  },
  {
    version: 22,
    name: "tags",
    up: (db) => {
      // Free-form tags. `name` is unique (case-sensitive storage) so one row is
      // shared across every item using it. item_tags is a polymorphic join so
      // invoices and customers can each carry tags.
      db.exec(`
        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          name TEXT NOT NULL UNIQUE,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS item_tags (
          tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          item_id TEXT NOT NULL,
          item_type TEXT NOT NULL CHECK(item_type IN ('invoice', 'customer')),
          PRIMARY KEY (tag_id, item_id, item_type)
        );
        CREATE INDEX IF NOT EXISTS idx_item_tags_item ON item_tags(item_id, item_type);
        CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);
      `);
    },
  },
  {
    version: 23,
    name: "invoice_groups",
    up: (db) => {
      // One row per consolidated invoice. `consolidated_invoice_id` points at
      // the merged draft the group produces; members are the source drafts that
      // were merged. Deleting the consolidated invoice removes the whole group.
      db.exec(`
        CREATE TABLE IF NOT EXISTS invoice_groups (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          name TEXT NOT NULL,
          consolidated_invoice_id TEXT REFERENCES invoices(id) ON DELETE CASCADE,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_invoice_groups_consolidated
          ON invoice_groups(consolidated_invoice_id);

        CREATE TABLE IF NOT EXISTS invoice_group_members (
          group_id TEXT NOT NULL REFERENCES invoice_groups(id) ON DELETE CASCADE,
          invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          PRIMARY KEY (group_id, invoice_id)
        );
        CREATE INDEX IF NOT EXISTS idx_invoice_group_members_invoice
          ON invoice_group_members(invoice_id);
      `);
    },
  },
  {
    version: 24,
    name: "peppol_transport",
    up: (db) => {
      // Outbound transmissions. One row per attempt-set (not per attempt); the
      // attempt log lives in einvoice_transmission_attempts so a retried send
      // keeps one stable identity and one idempotency key.
      db.exec(`
        CREATE TABLE IF NOT EXISTS einvoice_transmissions (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          einvoice_document_id TEXT NOT NULL REFERENCES einvoice_documents(id) ON DELETE CASCADE,
          transport_id TEXT NOT NULL,
          document_type TEXT NOT NULL,            -- invoice | credit-note
          sender_scheme TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          receiver_scheme TEXT NOT NULL,
          receiver_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',  -- queued|sending|sent|delivered|rejected|failed
          status_detail TEXT,
          provider_message_id TEXT,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          next_attempt_at TEXT,                   -- NULL when terminal
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          sent_at TEXT,
          delivered_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_einvoice_tx_invoice ON einvoice_transmissions(invoice_id);
        CREATE INDEX IF NOT EXISTS idx_einvoice_tx_status ON einvoice_transmissions(status);
        CREATE INDEX IF NOT EXISTS idx_einvoice_tx_due ON einvoice_transmissions(next_attempt_at)
          WHERE next_attempt_at IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_einvoice_tx_provider_msg
          ON einvoice_transmissions(provider_message_id) WHERE provider_message_id IS NOT NULL;

        -- Per-attempt audit trail. Mirrors webhook_deliveries in spirit.
        CREATE TABLE IF NOT EXISTS einvoice_transmission_attempts (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          transmission_id TEXT NOT NULL REFERENCES einvoice_transmissions(id) ON DELETE CASCADE,
          attempt_number INTEGER NOT NULL,
          status_code INTEGER,
          error_message TEXT,
          response_body TEXT,                     -- truncated to 4000 chars
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_einvoice_tx_attempts_tx
          ON einvoice_transmission_attempts(transmission_id);

        -- Our own network identity and its registration lifecycle. One active
        -- row per (transport, role) in the single-company OSS app; the table
        -- keeps history.
        CREATE TABLE IF NOT EXISTS peppol_participants (
          id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          transport_id TEXT NOT NULL,
          scheme TEXT NOT NULL,
          identifier TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'receiver',  -- receiver | sender
          status TEXT NOT NULL DEFAULT 'kyc_pending',
          status_detail TEXT,
          provider_ref TEXT,
          action_url TEXT,
          registered_at TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_peppol_participants_identity
          ON peppol_participants(transport_id, scheme, identifier, role);

        -- Idempotency guard for inbound callbacks. Providers retry aggressively.
        CREATE TABLE IF NOT EXISTS einvoice_webhook_events (
          id TEXT PRIMARY KEY,                    -- provider event id
          transport_id TEXT NOT NULL,
          received_at TEXT DEFAULT (datetime('now'))
        );
      `);

      // einvoice_inbox: distinguish network arrivals from manual uploads.
      addColumnIfMissing(db, "einvoice_inbox", "source", "TEXT DEFAULT 'upload'");
      addColumnIfMissing(db, "einvoice_inbox", "transport_id", "TEXT");
      addColumnIfMissing(db, "einvoice_inbox", "provider_message_id", "TEXT");
      addColumnIfMissing(db, "einvoice_inbox", "sender_scheme", "TEXT");
      addColumnIfMissing(db, "einvoice_inbox", "sender_id", "TEXT");

      // customers: cache the last network lookup so the invoice form can warn
      // early.
      addColumnIfMissing(db, "customers", "peppol_checked_at", "TEXT");
      addColumnIfMissing(db, "customers", "peppol_reachable", "INTEGER");
    },
  },
  {
    version: 25,
    name: "einvoice_france",
    up: (db) => {
      // French e-invoicing (PDP/PA routing). SIREN is the 9-digit business id
      // used for the annuaire lookup; SIRET is the optional 14-digit
      // establishment id. france_checked_at/france_reachable cache the last
      // lookup so the customer form can warn early (mirrors peppol_*).
      addColumnIfMissing(db, "customers", "siren", "TEXT");
      addColumnIfMissing(db, "customers", "siret", "TEXT");
      addColumnIfMissing(db, "customers", "france_checked_at", "TEXT");
      addColumnIfMissing(db, "customers", "france_reachable", "INTEGER");
    },
  },
  {
    version: 26,
    name: "oidc_identity",
    up: (db) => {
      // SSO identity of a user. NULL on password-only accounts. The partial
      // unique index keeps at most one account per (issuer, subject) pair
      // while allowing unlimited NULLs (SQLite treats NULLs as distinct).
      addColumnIfMissing(db, "users", "oidc_issuer", "TEXT");
      addColumnIfMissing(db, "users", "oidc_subject", "TEXT");
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oidc
          ON users(oidc_issuer, oidc_subject)
          WHERE oidc_issuer IS NOT NULL
      `);
    },
  },
  {
    version: 27,
    name: "recurring_auto_bill",
    up: (db) => {
      // Opt a recurring profile into charging the customer's saved card when
      // the profile fires. Default 0 keeps every existing profile on the
      // manual path.
      addColumnIfMissing(db, "recurring_invoices", "auto_bill", "INTEGER NOT NULL DEFAULT 0");
    },
  },
  {
    version: 28,
    name: "customer_payment_methods",
    up: (db) => {
      // Saved cards for off-session billing. Stripe tokens and display
      // metadata only: no PAN, no CVV, nothing that could reconstruct a card.
      // consent_text stores the mandate copy shown at capture, verbatim, so a
      // disputed charge can be answered with what the customer actually agreed to.
      db.exec(`
        CREATE TABLE IF NOT EXISTS customer_payment_methods (
          id                  TEXT PRIMARY KEY,
          customer_id         TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          gateway             TEXT NOT NULL DEFAULT 'stripe',
          gateway_customer_id TEXT NOT NULL,
          gateway_method_id   TEXT NOT NULL,
          brand               TEXT,
          last4               TEXT,
          exp_month           INTEGER,
          exp_year            INTEGER,
          is_default          INTEGER NOT NULL DEFAULT 0,
          consent_text        TEXT,
          consent_at          TEXT,
          created_at          TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_cpm_gateway_method
          ON customer_payment_methods(gateway, gateway_method_id)
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_cpm_customer
          ON customer_payment_methods(customer_id)
      `);
    },
  },
  {
    version: 29,
    name: "auto_bill_attempts",
    up: (db) => {
      // Dunning log and audit trail. One row per charge attempt, terminal when
      // next_retry_at is NULL. The unique index on (invoice_id, attempt_no) is
      // half the double-charge guard; the Stripe idempotency key is the other half.
      db.exec(`
        CREATE TABLE IF NOT EXISTS auto_bill_attempts (
          id                TEXT PRIMARY KEY,
          invoice_id        TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          recurring_id      TEXT,
          payment_method_id TEXT,
          attempt_no        INTEGER NOT NULL,
          status            TEXT NOT NULL,
          gateway_reference TEXT,
          error_code        TEXT,
          error_message     TEXT,
          next_retry_at     TEXT,
          created_at        TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_aba_invoice_attempt
          ON auto_bill_attempts(invoice_id, attempt_no)
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_aba_retry
          ON auto_bill_attempts(next_retry_at) WHERE next_retry_at IS NOT NULL
      `);
    },
  },
  {
    version: 30,
    name: "payments_reference_dedupe",
    up: (db) => {
      // Promoted from the cloud overlay (tenant-migrations.ts) so both
      // deployments share one idempotency guarantee. An existing self-hosted
      // database may already hold duplicate (invoice_id, reference) pairs from
      // a retried webhook, so deduplicate before the unique index goes on.
      const removed = db.run(`
        DELETE FROM payments
        WHERE reference IS NOT NULL
          AND rowid NOT IN (
            SELECT MIN(rowid) FROM payments
            WHERE reference IS NOT NULL
            GROUP BY invoice_id, reference
          )
      `);
      if (removed.changes > 0) {
        logger.warn(
          { removed: removed.changes },
          "Removed duplicate payment rows before adding the reference index",
        );
      }
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_invoice_reference
          ON payments(invoice_id, reference) WHERE reference IS NOT NULL
      `);
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
