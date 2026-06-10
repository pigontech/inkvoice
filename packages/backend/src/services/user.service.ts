import crypto from "node:crypto";
import { getDb } from "../database/connection";
import type { User } from "../types/user";
import { hashPassword } from "../utils/password";

function hasRoleColumn(): boolean {
  const db = getDb();
  const cols = db.query("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  return cols.some((c) => c.name === "role");
}

export function listUsers() {
  const db = getDb();
  const roleCol = hasRoleColumn() ? ", role" : "";
  return db
    .query(
      `SELECT id, username, email, display_name, is_admin, is_active, created_at, updated_at${roleCol} FROM users ORDER BY created_at`,
    )
    .all();
}

export function getUser(id: string) {
  const db = getDb();
  const roleCol = hasRoleColumn() ? ", role" : "";
  const user = db
    .query(
      `SELECT id, username, email, display_name, is_admin, is_active, created_at, updated_at${roleCol} FROM users WHERE id = ?`,
    )
    .get(id);
  if (!user) return null;

  const permissions = db
    .query("SELECT resource, action FROM user_permissions WHERE user_id = ?")
    .all(id);

  return { ...(user as Record<string, unknown>), permissions };
}

export async function createUser(data: {
  username: string;
  email?: string;
  display_name?: string;
  password: string;
  is_admin?: number;
  role?: string;
}) {
  const db = getDb();
  const id = crypto.randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(data.password);

  if (hasRoleColumn()) {
    const role = data.role ?? (data.is_admin ? "Owner" : "Viewer");
    db.run(
      "INSERT INTO users (id, username, email, display_name, password_hash, is_admin, role) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        data.username,
        data.email || null,
        data.display_name || null,
        passwordHash,
        data.is_admin ?? (role === "Owner" ? 1 : 0),
        role,
      ],
    );
  } else {
    db.run(
      "INSERT INTO users (id, username, email, display_name, password_hash, is_admin) VALUES (?, ?, ?, ?, ?, ?)",
      [
        id,
        data.username,
        data.email || null,
        data.display_name || null,
        passwordHash,
        data.is_admin ?? 0,
      ],
    );
  }

  return getUser(id);
}

export async function updateUser(
  id: string,
  data: {
    username?: string;
    email?: string;
    display_name?: string;
    password?: string;
    is_admin?: number;
    is_active?: number;
    role?: string;
  },
) {
  const db = getDb();
  const existing = db.query("SELECT * FROM users WHERE id = ?").get(id) as
    | (User & { role?: string })
    | null;
  if (!existing) return null;

  if (data.password) {
    const hash = await hashPassword(data.password);
    db.run("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?", [
      hash,
      id,
    ]);
  }

  if (hasRoleColumn()) {
    const newRole = data.role ?? existing.role ?? null;
    db.run(
      `UPDATE users SET username = ?, email = ?, display_name = ?, is_admin = ?, is_active = ?, role = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        data.username ?? existing.username,
        data.email ?? existing.email,
        data.display_name ?? existing.display_name,
        data.is_admin ?? existing.is_admin,
        data.is_active ?? existing.is_active,
        newRole,
        id,
      ],
    );
  } else {
    db.run(
      `UPDATE users SET username = ?, email = ?, display_name = ?, is_admin = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        data.username ?? existing.username,
        data.email ?? existing.email,
        data.display_name ?? existing.display_name,
        data.is_admin ?? existing.is_admin,
        data.is_active ?? existing.is_active,
        id,
      ],
    );
  }

  return getUser(id);
}

export function deleteUser(
  id: string,
  requestingUserId: string,
): { success: boolean; error?: string } {
  const db = getDb();

  if (id === requestingUserId) {
    return { success: false, error: "Cannot delete your own account" };
  }

  const adminCount = db
    .query("SELECT COUNT(*) as count FROM users WHERE is_admin = 1 AND is_active = 1")
    .get() as { count: number };
  const target = db.query("SELECT is_admin FROM users WHERE id = ?").get(id) as {
    is_admin: number;
  } | null;

  if (target?.is_admin && adminCount.count <= 1) {
    return { success: false, error: "Cannot delete the last admin user" };
  }

  db.run("DELETE FROM user_permissions WHERE user_id = ?", [id]);
  db.run("DELETE FROM users WHERE id = ?", [id]);
  return { success: true };
}

export function updatePermissions(
  userId: string,
  permissions: { resource: string; action: string }[],
) {
  const db = getDb();
  db.run("DELETE FROM user_permissions WHERE user_id = ?", [userId]);

  const stmt = db.prepare(
    "INSERT INTO user_permissions (id, user_id, resource, action) VALUES (?, ?, ?, ?)",
  );
  for (const perm of permissions) {
    const id = crypto.randomBytes(16).toString("hex");
    stmt.run(id, userId, perm.resource, perm.action);
  }

  return db.query("SELECT resource, action FROM user_permissions WHERE user_id = ?").all(userId);
}
