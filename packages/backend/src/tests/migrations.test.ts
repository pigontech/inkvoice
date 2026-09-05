import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { dbStorage } from "../database/connection";
import {
  LATEST_MIGRATION_VERSION,
  runMigrations,
  setMigrationBackupsEnabled,
} from "../database/migrations";
import { logger } from "../utils/logger";

const TEST_DB = "./data/test-migrations.db";

function freshDb(): Database {
  try {
    unlinkSync(TEST_DB);
  } catch {}
  try {
    unlinkSync(`${TEST_DB}-wal`);
  } catch {}
  try {
    unlinkSync(`${TEST_DB}-shm`);
  } catch {}
  const db = new Database(TEST_DB);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function runWith(db: Database, fn: () => void): void {
  // Disable backup writes during tests — backupDatabase reads
  // process.env.DATABASE_PATH which is unrelated to TEST_DB.
  setMigrationBackupsEnabled(false);
  try {
    dbStorage.run({ db, tenantId: "test-tenant" }, fn);
  } finally {
    setMigrationBackupsEnabled(true);
  }
}

describe("schema migration runner", () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(TEST_DB);
    } catch {}
    try {
      unlinkSync(`${TEST_DB}-wal`);
    } catch {}
    try {
      unlinkSync(`${TEST_DB}-shm`);
    } catch {}
  });

  test("fresh DB applies every migration in order", () => {
    runWith(db, () => runMigrations());

    const rows = db.query("SELECT version, name FROM schema_migrations ORDER BY version").all() as {
      version: number;
      name: string;
    }[];
    expect(rows.length).toBe(LATEST_MIGRATION_VERSION);
    expect(rows[0].version).toBe(1);
    expect(rows[rows.length - 1].version).toBe(LATEST_MIGRATION_VERSION);

    // Versions are strictly increasing.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].version).toBe(rows[i - 1].version + 1);
    }

    // applied_at is real (not "backfilled").
    const samples = db.query("SELECT applied_at FROM schema_migrations LIMIT 1").all() as {
      applied_at: string;
    }[];
    expect(samples[0].applied_at).not.toBe("backfilled");
  });

  test("re-running migrations is a no-op", () => {
    runWith(db, () => runMigrations());
    const before = db.query("SELECT applied_at FROM schema_migrations WHERE version = 1").get() as {
      applied_at: string;
    };

    runWith(db, () => runMigrations());
    const after = db.query("SELECT applied_at FROM schema_migrations WHERE version = 1").get() as {
      applied_at: string;
    };

    expect(before.applied_at).toBe(after.applied_at);
    const count = db.query("SELECT COUNT(*) as c FROM schema_migrations").get() as { c: number };
    expect(count.c).toBe(LATEST_MIGRATION_VERSION);
  });

  test("creates expected core tables", () => {
    runWith(db, () => runMigrations());

    const expected = [
      "settings",
      "customers",
      "tax_definitions",
      "products",
      "templates",
      "invoices",
      "invoice_items",
      "users",
      "user_permissions",
      "recurring_invoices",
      "payments",
      "activity_log",
      "reminder_rules",
      "reminder_log",
      "quotes",
      "quote_items",
      "feedback",
      "invoice_taxes",
      "invoice_item_taxes",
      "product_categories",
      "product_units",
      "portal_tokens",
      "invoice_comments",
      "outgoing_webhooks",
      "webhook_deliveries",
    ];

    for (const name of expected) {
      const row = db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .get(name) as { name: string } | null;
      expect(row?.name).toBe(name);
    }
  });

  test("pre-versioning DB is backfilled instead of re-running migrations", () => {
    // Simulate an existing DB where migrations ran via the old pragma-based
    // path: customers (and friends) exist, but schema_migrations does not.
    db.exec(`
      CREATE TABLE customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      INSERT INTO customers (id, name) VALUES ('seed1', 'Pre-existing customer');
    `);

    runWith(db, () => runMigrations());

    const rows = db
      .query("SELECT version, applied_at FROM schema_migrations ORDER BY version")
      .all() as { version: number; applied_at: string }[];
    expect(rows.length).toBe(LATEST_MIGRATION_VERSION);
    expect(rows.every((r) => r.applied_at === "backfilled")).toBe(true);

    // Pre-existing data is preserved — backfill must not re-run migration #1.
    const cust = db.query("SELECT name FROM customers WHERE id = 'seed1'").get() as {
      name: string;
    } | null;
    expect(cust?.name).toBe("Pre-existing customer");
  });

  test("applies only new migrations on subsequent runs", () => {
    runWith(db, () => runMigrations());

    // Pretend version 10 was the previous tip, then revert one row to simulate
    // what happens if a hypothetical version 11 migration ships.
    db.exec(`DELETE FROM schema_migrations WHERE version = ${LATEST_MIGRATION_VERSION}`);
    const before = db.query("SELECT COUNT(*) as c FROM schema_migrations").get() as { c: number };
    expect(before.c).toBe(LATEST_MIGRATION_VERSION - 1);

    runWith(db, () => runMigrations());

    const after = db.query("SELECT COUNT(*) as c FROM schema_migrations").get() as { c: number };
    expect(after.c).toBe(LATEST_MIGRATION_VERSION);
  });

  test("version 24 creates the PEPPOL transport tables and inbox columns", () => {
    runWith(db, () => runMigrations());

    const tables = [
      "einvoice_transmissions",
      "einvoice_transmission_attempts",
      "peppol_participants",
      "einvoice_webhook_events",
    ];
    for (const name of tables) {
      const row = db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .get(name) as { name: string } | null;
      expect(row?.name, name).toBe(name);
    }

    // Column additions land on einvoice_inbox without disturbing existing rows.
    const custCols = db
      .query(
        "SELECT name FROM pragma_table_info('einvoice_inbox') WHERE name LIKE 'source' OR name LIKE 'transport_id' OR name LIKE 'provider_message_id' OR name LIKE 'sender_scheme' OR name LIKE 'sender_id'",
      )
      .all() as { name: string }[];
    expect(custCols.map((c) => c.name).sort()).toEqual([
      "provider_message_id",
      "sender_id",
      "sender_scheme",
      "source",
      "transport_id",
    ]);

    const customerCols = db
      .query("SELECT name FROM pragma_table_info('customers') WHERE name LIKE 'peppol_%'")
      .all() as { name: string }[];
    expect(customerCols.map((c) => c.name).sort()).toEqual([
      "peppol_checked_at",
      "peppol_reachable",
    ]);

    // The partial unique index on provider_message_id exists.
    const idx = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_einvoice_tx_provider_msg'",
      )
      .get() as { name: string } | null;
    expect(idx?.name).toBe("idx_einvoice_tx_provider_msg");
  });

  test("france columns exist on customers", () => {
    runWith(db, () => runMigrations());
    const cols = db
      .query("SELECT name FROM pragma_table_info('customers')")
      .all() as unknown as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    for (const col of ["siren", "siret", "france_checked_at", "france_reachable"]) {
      expect(names).toContain(col);
    }
  });

  test("version 24 applies on a database already at version 23", () => {
    // Apply everything except the migrations above v23, then apply the remainder.
    runWith(db, () => runMigrations());
    db.exec("DELETE FROM schema_migrations WHERE version > 23");

    // Simulate a real v23 tip: drop the v24 tables (as if never created).
    db.exec("DROP TABLE einvoice_webhook_events");
    db.exec("DROP TABLE peppol_participants");
    db.exec("DROP TABLE einvoice_transmission_attempts");
    db.exec("DROP TABLE einvoice_transmissions");

    runWith(db, () => runMigrations());

    const row = db.query("SELECT version FROM schema_migrations WHERE version = ?").get(24) as {
      version: number;
    } | null;
    expect(row?.version).toBe(24);
    const exists = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'einvoice_transmissions'",
      )
      .get() as { name: string } | null;
    expect(exists?.name).toBe("einvoice_transmissions");
  });

  test("version 26 adds OIDC identity columns and the partial unique index", () => {
    runWith(db, () => runMigrations());

    const cols = db.query("SELECT name FROM pragma_table_info('users')").all() as unknown as Array<{
      name: string;
    }>;
    const names = cols.map((c) => c.name);
    for (const col of ["oidc_issuer", "oidc_subject"]) {
      expect(names).toContain(col);
    }

    const idx = db
      .query("SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_users_oidc'")
      .get() as { name: string } | null;
    expect(idx?.name).toBe("idx_users_oidc");
  });

  test("version 26 enforces one (issuer, subject) pair per row", () => {
    runWith(db, () => runMigrations());
    // Prepared statements (query().run()) throw on constraint violations;
    // multi-line db.exec batches silently swallow them in bun:sqlite.
    db.query(`
      INSERT INTO users (id, username, password_hash, oidc_issuer, oidc_subject)
      VALUES ('a1', 'sso-one', 'x', 'https://issuer', 'sub-1');
    `).run();
    db.query(`
      INSERT INTO users (id, username, password_hash, oidc_issuer, oidc_subject)
      VALUES ('a2', 'sso-two', 'x', 'https://issuer', 'sub-2');
    `).run();
    // Duplicate (issuer, subject) must be rejected by the partial index.
    expect(() =>
      db
        .query(`
        INSERT INTO users (id, username, password_hash, oidc_issuer, oidc_subject)
        VALUES ('a3', 'sso-three', 'x', 'https://issuer', 'sub-1');
      `)
        .run(),
    ).toThrow();
  });

  test("migrations reach version 30", () => {
    expect(LATEST_MIGRATION_VERSION).toBe(30);
  });

  test("customer_payment_methods has the expected shape", () => {
    runWith(db, () => runMigrations());
    const cols = (
      db.query("SELECT name FROM pragma_table_info('customer_payment_methods')").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    for (const c of [
      "id",
      "customer_id",
      "gateway",
      "gateway_customer_id",
      "gateway_method_id",
      "brand",
      "last4",
      "exp_month",
      "exp_year",
      "is_default",
      "consent_text",
      "consent_at",
      "created_at",
    ]) {
      expect(cols).toContain(c);
    }
  });

  test("auto_bill_attempts has the expected shape", () => {
    runWith(db, () => runMigrations());
    const cols = (
      db.query("SELECT name FROM pragma_table_info('auto_bill_attempts')").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    for (const c of [
      "id",
      "invoice_id",
      "recurring_id",
      "payment_method_id",
      "attempt_no",
      "status",
      "gateway_reference",
      "error_code",
      "error_message",
      "next_retry_at",
      "created_at",
    ]) {
      expect(cols).toContain(c);
    }
  });

  test("payments dedupe index exists", () => {
    runWith(db, () => runMigrations());
    const idx = db
      .query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get("ux_payments_invoice_reference") as { name: string } | null;
    expect(idx).toBeTruthy();
  });

  test("migration 30 dedupes duplicate (invoice_id, reference) payments, keeping the older row", () => {
    // Run the full chain once (this already applies migration 30 against an
    // empty payments table). To prove the dedupe branch itself, roll back
    // just that migration's effects, seed dirty data, then let runMigrations()
    // re-apply version 30 against it.
    runWith(db, () => runMigrations());
    db.exec("DROP INDEX IF EXISTS ux_payments_invoice_reference");
    db.exec("DELETE FROM schema_migrations WHERE version = 30");

    db.exec(`
      INSERT INTO customers (id, name) VALUES ('cust1', 'Test Co');
      INSERT INTO invoices (id, invoice_number, customer_id, issue_date)
        VALUES ('inv1', 'INV-0001', 'cust1', '2026-01-01');
    `);

    // Two payments sharing (invoice_id, reference): a genuine duplicate pair
    // from, e.g., a retried webhook. pay-old is inserted first so it holds
    // the lower rowid and must be the one the dedupe keeps.
    db.query(`
      INSERT INTO payments (id, invoice_id, amount, payment_date, reference)
      VALUES ('pay-old', 'inv1', 100, '2026-01-01', 'ref-dup')
    `).run();
    db.query(`
      INSERT INTO payments (id, invoice_id, amount, payment_date, reference)
      VALUES ('pay-new', 'inv1', 100, '2026-01-02', 'ref-dup')
    `).run();
    // Control row: different reference, must survive untouched.
    db.query(`
      INSERT INTO payments (id, invoice_id, amount, payment_date, reference)
      VALUES ('pay-control', 'inv1', 50, '2026-01-03', 'ref-control')
    `).run();
    // Two rows with a NULL reference. The index is partial (WHERE reference
    // IS NOT NULL) and the DELETE also filters on reference IS NOT NULL, so
    // neither should ever be considered a duplicate of the other.
    db.query(`
      INSERT INTO payments (id, invoice_id, amount, payment_date, reference)
      VALUES ('pay-null-a', 'inv1', 25, '2026-01-04', NULL)
    `).run();
    db.query(`
      INSERT INTO payments (id, invoice_id, amount, payment_date, reference)
      VALUES ('pay-null-b', 'inv1', 25, '2026-01-05', NULL)
    `).run();

    const rowidOf = (id: string) =>
      (db.query("SELECT rowid as r FROM payments WHERE id = ?").get(id) as { r: number }).r;
    const oldRowid = rowidOf("pay-old");
    const newRowid = rowidOf("pay-new");
    expect(oldRowid).toBeLessThan(newRowid);

    const warnSpy = spyOn(logger, "warn");
    runWith(db, () => runMigrations());

    // Exactly one of the duplicate pair remains, and it is the older row.
    const dupRows = db.query("SELECT id FROM payments WHERE reference = 'ref-dup'").all() as {
      id: string;
    }[];
    expect(dupRows.length).toBe(1);
    expect(dupRows[0].id).toBe("pay-old");

    // The control row is untouched.
    const control = db.query("SELECT id FROM payments WHERE id = 'pay-control'").get() as {
      id: string;
    } | null;
    expect(control?.id).toBe("pay-control");

    // Both NULL-reference rows survive untouched.
    const nullRows = db.query("SELECT id FROM payments WHERE reference IS NULL").all() as {
      id: string;
    }[];
    expect(nullRows.map((r) => r.id).sort()).toEqual(["pay-null-a", "pay-null-b"]);

    // The unique index is (re-)created.
    const idx = db
      .query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get("ux_payments_invoice_reference") as { name: string } | null;
    expect(idx?.name).toBe("ux_payments_invoice_reference");

    // The migration logged the removal with the correct count.
    expect(warnSpy).toHaveBeenCalledWith(
      { removed: 1 },
      "Removed duplicate payment rows before adding the reference index",
    );
    warnSpy.mockRestore();
  });

  test("migration 30 recalculates amount_paid for an invoice whose dedupe destroyed a genuine partial payment", () => {
    // Two GENUINE partial payments on the same invoice, both tagged with the
    // same free text reference ("cash") because that is all the user typed
    // into the manual payment endpoint. The dedupe cannot tell this apart
    // from a retried webhook and still has to remove one to satisfy the
    // unique index, but afterwards invoices.amount_paid must reflect the rows
    // that actually survived, not the stale pre-dedupe total.
    runWith(db, () => runMigrations());
    db.exec("DROP INDEX IF EXISTS ux_payments_invoice_reference");
    db.exec("DELETE FROM schema_migrations WHERE version = 30");

    db.exec(`
      INSERT INTO customers (id, name) VALUES ('cust2', 'Recalc Co');
      INSERT INTO invoices (id, invoice_number, customer_id, issue_date, status, total, amount_paid)
        VALUES ('inv2', 'INV-0002', 'cust2', '2026-01-01', 'partially_paid', 300, 120);
    `);

    // pay-cash-1 (50) and pay-cash-2 (70) are two real payments, correctly
    // summed into the invoice's seeded amount_paid of 120 before migration.
    db.query(`
      INSERT INTO payments (id, invoice_id, amount, payment_date, reference)
      VALUES ('pay-cash-1', 'inv2', 50, '2026-01-01', 'cash')
    `).run();
    db.query(`
      INSERT INTO payments (id, invoice_id, amount, payment_date, reference)
      VALUES ('pay-cash-2', 'inv2', 70, '2026-01-05', 'cash')
    `).run();

    const warnSpy = spyOn(logger, "warn");
    runWith(db, () => runMigrations());

    // The dedupe kept the older row and removed the newer one, exactly like
    // the existing dedupe test, even though both were genuine payments.
    const remaining = db.query("SELECT id FROM payments WHERE invoice_id = 'inv2'").all() as {
      id: string;
    }[];
    expect(remaining.map((r) => r.id)).toEqual(["pay-cash-1"]);

    // amount_paid must now match the SUM of the surviving rows (50), not the
    // stale pre-dedupe value (120) the invoice was seeded with, and status
    // must be recalculated the same way the app would.
    const invoice = db
      .query("SELECT amount_paid, status FROM invoices WHERE id = 'inv2'")
      .get() as { amount_paid: number; status: string };
    expect(invoice.amount_paid).toBe(50);
    expect(invoice.status).toBe("partially_paid");

    // The removed row's invoice_id, reference and amount are logged, not just
    // a count, so an operator can reconcile a genuine payment the dedupe had
    // to remove.
    expect(warnSpy).toHaveBeenCalledWith(
      { removedRows: [{ invoice_id: "inv2", reference: "cash", amount: 70 }] },
      "Duplicate payment rows removed by migration 30, reconcile manually if any were genuine partial payments",
    );
    warnSpy.mockRestore();
  });
});
