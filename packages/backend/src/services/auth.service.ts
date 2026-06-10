import { getDb } from "../database/connection";
import type { User } from "../types/user";
import { signToken } from "../utils/jwt";
import { verifyPassword } from "../utils/password";

export async function login(username: string, password: string, tenantId?: string) {
  const db = getDb();
  const user = db
    .query("SELECT * FROM users WHERE username = ? AND is_active = 1")
    .get(username) as User | null;

  if (!user) {
    return null;
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return null;
  }

  const token = await signToken({
    sub: user.id,
    username: user.username,
    is_admin: !!user.is_admin,
    tenant_id: tenantId,
  });

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      display_name: user.display_name,
      is_admin: !!user.is_admin,
      role: user.role ?? null,
    },
  };
}

export function getCurrentUser(userId: string) {
  const db = getDb();
  const user = db
    .query(
      "SELECT id, username, email, display_name, is_admin, role FROM users WHERE id = ? AND is_active = 1",
    )
    .get(userId) as Omit<User, "password_hash" | "is_active" | "created_at" | "updated_at"> | null;

  if (!user) return null;

  const permissions = db
    .query("SELECT resource, action FROM user_permissions WHERE user_id = ?")
    .all(userId) as { resource: string; action: string }[];

  return { ...user, is_admin: !!user.is_admin, permissions };
}
