import { Hono } from "hono";
import { z } from "zod";
import { logActivity } from "../services/activity.service";
import * as userService from "../services/user.service";

const users = new Hono();

users.get("/", (c) => {
  const data = userService.listUsers();
  return c.json({ success: true, data });
});

users.get("/:id", (c) => {
  const user = userService.getUser(c.req.param("id"));
  if (!user) {
    return c.json({ success: false, error: "User not found" }, 404);
  }
  return c.json({ success: true, data: user });
});

const ROLE_ENUM = z.enum(["Owner", "Admin", "Accountant", "Viewer"]);

const createUserSchema = z.object({
  username: z.string().min(1).max(50),
  email: z.string().email().optional().or(z.literal("")),
  display_name: z.string().max(100).optional().or(z.literal("")),
  password: z.string().min(12, "Password must be at least 12 characters"),
  is_admin: z.number().min(0).max(1).optional(),
  role: ROLE_ENUM.optional(),
});

users.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createUserSchema.parse(body);
  const user = await userService.createUser(parsed);
  return c.json({ success: true, data: user }, 201);
});

const updateUserSchema = z.object({
  username: z.string().min(1).max(50).optional(),
  email: z.string().email().optional().or(z.literal("")),
  display_name: z.string().max(100).optional().or(z.literal("")),
  password: z.string().min(12, "Password must be at least 12 characters").optional(),
  is_admin: z.number().min(0).max(1).optional(),
  is_active: z.number().min(0).max(1).optional(),
  role: ROLE_ENUM.optional(),
});

users.put("/:id", async (c) => {
  const body = await c.req.json();
  const parsed = updateUserSchema.parse(body);
  const user = await userService.updateUser(c.req.param("id"), parsed);
  if (!user) {
    return c.json({ success: false, error: "User not found" }, 404);
  }
  return c.json({ success: true, data: user });
});

users.delete("/:id", (c) => {
  const userId = c.get("userId");
  const result = userService.deleteUser(c.req.param("id"), userId);
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 400);
  }
  return c.json({ success: true });
});

const batchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  action: z.enum(["delete", "activate", "deactivate"]),
});

users.post("/batch", async (c) => {
  const body = await c.req.json();
  const parsed = batchSchema.parse(body);
  const userId = c.get("userId");
  const errors: { id: string; reason: string }[] = [];
  let succeeded = 0;

  for (const id of parsed.ids) {
    if (id === userId) {
      errors.push({ id, reason: "Cannot modify own account" });
      continue;
    }
    try {
      if (parsed.action === "delete") {
        const result = userService.deleteUser(id, userId);
        if (result.success) {
          succeeded++;
        } else {
          errors.push({ id, reason: result.error || "Cannot delete" });
        }
      } else if (parsed.action === "activate") {
        await userService.updateUser(id, { is_active: 1 });
        succeeded++;
      } else if (parsed.action === "deactivate") {
        await userService.updateUser(id, { is_active: 0 });
        succeeded++;
      }
    } catch {
      errors.push({ id, reason: "Unexpected error" });
    }
  }

  return c.json({ success: true, data: { succeeded, failed: errors.length, errors } });
});

const permissionsSchema = z.object({
  permissions: z.array(
    z.object({
      resource: z.enum([
        "invoices",
        "customers",
        "products",
        "templates",
        "settings",
        "tax_definitions",
        "users",
      ]),
      action: z.enum(["read", "create", "update", "delete", "publish", "void", "export"]),
    }),
  ),
});

users.put("/:id/permissions", async (c) => {
  const body = await c.req.json();
  const parsed = permissionsSchema.parse(body);
  const targetId = c.req.param("id");
  const target = userService.getUser(targetId) as { username?: string } | null;
  const data = userService.updatePermissions(targetId, parsed.permissions);

  // Audit log: who changed which user's permissions, with the new set as
  // metadata so the change is reconstructable from the log alone.
  const actorId = c.get("userId") as string | undefined;
  const actor = actorId ? (userService.getUser(actorId) as { username?: string } | null) : null;
  logActivity({
    user_id: actorId ?? null,
    user_name: actor?.username ?? null,
    action: "update_permissions",
    resource_type: "user",
    resource_id: targetId,
    metadata: {
      target_username: target?.username,
      permissions: parsed.permissions,
    },
  });

  return c.json({ success: true, data });
});

export { users };
