import crypto from "node:crypto";
import { getDb } from "../database/connection";

// Public API tokens for integrations (Zapier/Make, custom scripts). Tokens are
// opaque, high-entropy random strings prefixed with `ink_`. Only their SHA-256
// hash is persisted; the plain token is returned once at creation and never
// again. Because the token carries full entropy, a plain digest (not bcrypt) is
// the right hash here — it allows O(1) lookup by hash on every request.

export interface ApiTokenRecord {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
}

interface ApiTokenRow {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  scopes: string;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateToken(): { token: string; prefix: string } {
  const token = `ink_${crypto.randomBytes(24).toString("base64url")}`;
  // First 12 chars ("ink_" + 8 random) identify the token in the UI.
  return { token, prefix: token.slice(0, 12) };
}

function toRecord(row: ApiTokenRow): ApiTokenRecord {
  let scopes: string[] = [];
  try {
    scopes = JSON.parse(row.scopes) as string[];
  } catch {
    scopes = [];
  }
  return {
    id: row.id,
    name: row.name,
    token_prefix: row.token_prefix,
    scopes,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
  };
}

export function createToken(
  userId: string,
  name: string,
  scopes: string[],
): { token: string; record: ApiTokenRecord } {
  const db = getDb();
  const { token, prefix } = generateToken();
  const id = crypto.randomBytes(16).toString("hex");
  db.run(
    `INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, name, hashToken(token), prefix, JSON.stringify(scopes)],
  );
  const row = db.query("SELECT * FROM api_tokens WHERE id = ?").get(id) as ApiTokenRow;
  return { token, record: toRecord(row) };
}

export function listTokens(userId: string): ApiTokenRecord[] {
  const db = getDb();
  const rows = db
    .query(
      "SELECT * FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
    )
    .all(userId) as ApiTokenRow[];
  return rows.map(toRecord);
}

export function revokeToken(id: string, userId: string): boolean {
  const db = getDb();
  const res = db.run(
    "UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
    [id, userId],
  );
  return res.changes > 0;
}

/** Resolve a presented token to its active row, or null if unknown/revoked. */
export function findActiveTokenByHash(
  hash: string,
): { id: string; user_id: string; scopes: string[] } | null {
  const db = getDb();
  const row = db
    .query("SELECT * FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL")
    .get(hash) as ApiTokenRow | null;
  if (!row) return null;
  return { id: row.id, user_id: row.user_id, scopes: toRecord(row).scopes };
}

export function touchLastUsed(id: string): void {
  const db = getDb();
  db.run("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?", [id]);
}
