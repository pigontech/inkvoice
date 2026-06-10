// Named roles → permission bundles. Replaces the legacy per-user-permission
// checkbox grid. user_permissions table is retained but unused by the new
// requirePermission middleware path.

import type { Action, Resource } from "../types/user";

export type Role = "Owner" | "Admin" | "Accountant" | "Viewer";
export const ROLES: Role[] = ["Owner", "Admin", "Accountant", "Viewer"];

const ALL_ACTIONS: Action[] = ["read", "create", "update", "delete", "publish", "void", "export"];

const READ_ACTIONS: Action[] = ["read", "export"];

const ACCOUNTING_RESOURCES: Resource[] = ["invoices", "customers", "products", "tax_definitions"];

interface RoleSpec {
  /**
   * Resource → set of allowed actions. Wildcard "*" means all actions.
   * Missing resource means no access at all.
   */
  permissions: Partial<Record<Resource, Action[] | "*">>;
}

const ROLE_SPECS: Record<Role, RoleSpec> = {
  Owner: {
    // Owner is unrestricted — short-circuited in `roleAllows`.
    permissions: {},
  },
  Admin: {
    permissions: {
      invoices: "*",
      customers: "*",
      products: "*",
      tax_definitions: "*",
      templates: "*",
      settings: ["read", "update"],
      // Admin can manage users but cannot delete the Owner — enforced at
      // service level, not here.
      users: ["read", "create", "update"],
    },
  },
  Accountant: {
    permissions: {
      invoices: ALL_ACTIONS,
      customers: ALL_ACTIONS,
      products: ALL_ACTIONS,
      tax_definitions: ["read"],
      templates: ["read"],
      settings: ["read"],
    },
  },
  Viewer: {
    permissions: {
      invoices: READ_ACTIONS,
      customers: READ_ACTIONS,
      products: READ_ACTIONS,
      tax_definitions: ["read"],
      templates: ["read"],
      settings: ["read"],
    },
  },
};

export function isValidRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as string[]).includes(value);
}

/**
 * Returns true if `role` permits `action` on `resource`. Owner short-circuits
 * to true. Unknown roles deny.
 */
export function roleAllows(
  role: string | undefined | null,
  resource: Resource,
  action: Action,
): boolean {
  if (!role) return false;
  if (role === "Owner") return true;
  const spec = ROLE_SPECS[role as Role];
  if (!spec) return false;
  const allowed = spec.permissions[resource];
  if (!allowed) return false;
  if (allowed === "*") return true;
  return allowed.includes(action);
}
