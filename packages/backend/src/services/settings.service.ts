import { getDb } from "../database/connection";

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
