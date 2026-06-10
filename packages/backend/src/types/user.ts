export interface User {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  password_hash: string;
  is_admin: number;
  is_active: number;
  /** RBAC role ("Owner" | "Admin" | "Accountant" | "Viewer"); null on legacy rows. */
  role: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserPermission {
  id: string;
  user_id: string;
  resource: string;
  action: string;
}

export type Resource =
  | "invoices"
  | "customers"
  | "products"
  | "templates"
  | "settings"
  | "tax_definitions"
  | "users";
export type Action = "read" | "create" | "update" | "delete" | "publish" | "void" | "export";
