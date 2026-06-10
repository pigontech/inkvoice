import { Database } from "bun:sqlite";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { todayIso } from "../utils/date";
import { getEnv } from "../utils/env";

const exportRoutes = new Hono();

exportRoutes.get("/backup", (c) => {
  const db = getDb();

  const settings = db.query("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const settingsObj = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  const customers = db.query("SELECT * FROM customers").all();
  const products = db.query("SELECT * FROM products").all();
  const taxDefinitions = db.query("SELECT * FROM tax_definitions").all();
  const invoices = db.query("SELECT * FROM invoices").all();
  const invoiceItems = db.query("SELECT * FROM invoice_items").all();
  const templates = db.query("SELECT * FROM templates").all();
  const users = db
    .query(
      "SELECT id, username, email, display_name, is_admin, is_active, created_at, updated_at FROM users",
    )
    .all();
  const userPermissions = db.query("SELECT * FROM user_permissions").all();

  const backup = {
    version: "1.0",
    exported_at: new Date().toISOString(),
    data: {
      settings: settingsObj,
      customers,
      products,
      tax_definitions: taxDefinitions,
      invoices,
      invoice_items: invoiceItems,
      templates,
      users,
      user_permissions: userPermissions,
    },
  };

  c.header("Content-Type", "application/json");
  c.header("Content-Disposition", `attachment; filename="inkvoice-backup-${todayIso()}.json"`);
  return c.body(JSON.stringify(backup, null, 2));
});

/**
 * Streams a consistent SQLite snapshot of the live database. Uses
 * `VACUUM INTO` so the backup is taken atomically without blocking writers
 * for long, and is a single-file copy that can be `cp`-ed back to disk to
 * restore.
 */
exportRoutes.get("/sqlite", (c) => {
  // Don't snapshot into the data dir — keep it in tmp so a stuck file can't
  // pollute the user's data directory if streaming fails.
  const tmpPath = join(tmpdir(), `inkvoice-snapshot-${process.pid}-${Date.now()}.db`);

  try {
    const db = getDb();
    db.exec(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);

    if (!existsSync(tmpPath)) {
      return c.json({ success: false, error: "Snapshot creation failed" }, 500);
    }

    const buf = readFileSync(tmpPath);

    c.header("Content-Type", "application/octet-stream");
    c.header("Content-Disposition", `attachment; filename="inkvoice-${todayIso()}.db"`);
    return c.body(buf);
  } catch (err) {
    return c.json(
      { success: false, error: err instanceof Error ? err.message : "Backup failed" },
      500,
    );
  } finally {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }
  }
});

const SQLITE_MAGIC = "SQLite format 3\0";

function looksLikeSqlite(buf: Uint8Array): boolean {
  if (buf.length < SQLITE_MAGIC.length) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) {
    if (buf[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

// Extension point: restore/wipe replace or empty the live env.DATABASE_PATH
// file. A deployment whose databases are managed elsewhere (e.g. scoped per
// workspace via async-local storage) disables them.
let destructiveDbOpsEnabled = true;

export function setDestructiveDbOpsEnabled(enabled: boolean): void {
  destructiveDbOpsEnabled = enabled;
}

/**
 * Replace the live database with an uploaded SQLite snapshot.
 *
 * Flow:
 *   1. Verify the upload is a SQLite file by magic header.
 *   2. Write it to a side path and run `PRAGMA integrity_check` against it.
 *   3. Close the live DB connection.
 *   4. Rename the current DB aside (kept on disk as a safety net).
 *   5. Move the verified file into place and re-open.
 *   6. Run migrations so older snapshots get any newly-added columns.
 */
exportRoutes.post("/restore", async (c) => {
  if (!destructiveDbOpsEnabled) {
    return c.json({ success: false, error: "Restore is not available in this deployment" }, 400);
  }

  const body = await c.req.parseBody();
  const file = body.backup;
  if (!file || !(file instanceof File)) {
    return c.json({ success: false, error: "No backup file provided" }, 400);
  }
  if (file.size === 0 || file.size > 500 * 1024 * 1024) {
    return c.json({ success: false, error: "Backup file is empty or too large (>500MB)" }, 400);
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeSqlite(buf)) {
    return c.json({ success: false, error: "Not a valid SQLite database file" }, 400);
  }

  const dbPath = getEnv().DATABASE_PATH;
  const ts = todayIso();
  const sidePath = `${dbPath}.replaced-${ts}-${Date.now()}`;
  const incomingPath = `${dbPath}.incoming-${Date.now()}`;

  try {
    // Stage to disk and run an integrity check before touching the live DB.
    writeFileSync(incomingPath, buf);
    const probe = new Database(incomingPath, { readonly: true });
    try {
      const integrity = probe.query("PRAGMA integrity_check").get() as {
        integrity_check: string;
      } | null;
      if (!integrity || integrity.integrity_check !== "ok") {
        return c.json({ success: false, error: "Backup failed integrity check" }, 400);
      }
    } finally {
      probe.close();
    }

    // Swap files
    closeDatabase();
    if (existsSync(dbPath)) renameSync(dbPath, sidePath);
    renameSync(incomingPath, dbPath);

    // Re-open and migrate so older snapshots get current schema
    initDatabase();
    runMigrations();
    await seed();

    return c.json({
      success: true,
      data: { previous_db_kept_at: sidePath },
    });
  } catch (err) {
    // Best-effort recovery: if we already moved the live DB aside, restore it.
    try {
      if (existsSync(sidePath) && !existsSync(dbPath)) renameSync(sidePath, dbPath);
      initDatabase();
    } catch {
      // ignore — admin will need to recover from sidePath manually
    }
    try {
      if (existsSync(incomingPath)) unlinkSync(incomingPath);
    } catch {
      // ignore
    }
    return c.json(
      { success: false, error: err instanceof Error ? err.message : "Restore failed" },
      500,
    );
  }
});

/**
 * Wipe every business record. Resets settings to defaults and re-seeds an
 * empty database, but preserves the admin user (so the operator can still
 * log in afterward).
 */
exportRoutes.post("/wipe", async (c) => {
  if (!destructiveDbOpsEnabled) {
    return c.json({ success: false, error: "Wipe is not available in this deployment" }, 400);
  }

  const body = (await c.req.json().catch(() => ({}))) as { confirm?: string };
  if (body.confirm !== "DELETE") {
    return c.json({ success: false, error: "Confirmation phrase required" }, 400);
  }

  const db = getDb();
  // Order matters — child tables before parents to satisfy FKs.
  const wipeOrder = [
    "invoice_comments",
    "invoice_item_taxes",
    "invoice_taxes",
    "invoice_items",
    "quote_items",
    "payments",
    "reminder_log",
    "activity_log",
    "expenses",
    "recurring_invoices",
    "invoices",
    "quotes",
    "products",
    "tax_definitions",
    "customers",
    "portal_tokens",
    "templates",
    "settings",
    "feedback",
  ];

  db.transaction(() => {
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      for (const table of wipeOrder) {
        try {
          db.run(`DELETE FROM ${table}`);
        } catch {
          // Table may not exist (older schemas) — ignore and continue
        }
      }
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
  })();

  // Re-seed defaults (settings, default tax def, builtin templates).
  // Admin user already exists, seed() is idempotent on it.
  await seed();

  return c.json({ success: true, data: { message: "All data wiped" } });
});

export { exportRoutes };
