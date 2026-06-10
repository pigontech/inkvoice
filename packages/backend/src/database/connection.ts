import { Database } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getEnv } from "../utils/env";

export interface TenantContext {
  db: Database;
  /** Workspace ID; only present in multi-tenant deployments. */
  tenantId?: string;
}

// AsyncLocalStorage for per-request DB + tenant context. A multi-tenant
// deployment's middleware populates it per request; standalone installs use
// the singleton DB fallback and leave ALS unused.
export const dbStorage = new AsyncLocalStorage<TenantContext>();

let db: Database | null = null;

export function getDb(): Database {
  // Check ALS first (multi-tenant deployments populate it per request)
  const ctx = dbStorage.getStore();
  if (ctx) return ctx.db;

  // Fall back to singleton (self-hosted mode)
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

/**
 * Returns the tenant ID bound to the current ALS context, if any. Used by
 * code paths that run outside an HTTP request (schedulers, encryption
 * helpers) and therefore can't read `c.get("tenant")`.
 *
 * Returns undefined in self-hosted mode and outside any ALS context.
 */
export function getCurrentTenantId(): string | undefined {
  return dbStorage.getStore()?.tenantId;
}

export function initDatabase(): void {
  const env = getEnv();
  const dbPath = env.DATABASE_PATH;

  mkdirSync(dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
