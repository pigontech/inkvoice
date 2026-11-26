import { getDb } from "../database/connection";

// Internal catalog bookkeeping (cache blobs and fetch timestamps) lives in the
// settings table but is not user-facing; handing it to the frontend would have
// browsers cache potentially large JSON blobs, and exports have no use for it.
// plugin_catalog_url is a real setting and stays visible.
const INTERNAL_SETTINGS = new Set([
  "plugin_catalog_cache",
  "plugin_catalog_synced_at",
  "plugin_catalog_votes",
  "plugin_catalog_votes_at",
  // Install-local secret behind the opaque vote identity. Never leaves the
  // server; handing it to a browser would let anyone mint another install's
  // vote identities.
  "plugin_vote_secret",
  // Update-check bookkeeping (see update-check.service.ts).
  "update_check_cache",
]);

export function isInternalSetting(key: string): boolean {
  return INTERNAL_SETTINGS.has(key);
}

export function stripInternalSettings(data: Record<string, string>): Record<string, string> {
  const visible: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!INTERNAL_SETTINGS.has(key)) visible[key] = value;
  }
  return visible;
}

export function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.query("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

export function updateSettings(settings: Record<string, string>): void {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  );
  for (const [key, value] of Object.entries(settings)) {
    stmt.run(key, value);
  }
}

export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as {
    value: string;
  } | null;
  return row?.value ?? null;
}
