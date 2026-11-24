import { Hono } from "hono";
import { hasPermission } from "../middleware/auth";
import { getResourceActivity, listActivity } from "../services/activity.service";
import type { Resource } from "../types/user";

const activity = new Hono();

// The log records what happened to a record, so reading an entry needs read
// access to that kind of record. Anything not listed here (user accounts,
// logins, permission changes, Peppol registration) is for admins only, and so
// is any type added later until it is listed.
const RESOURCE_FOR_TYPE: Record<string, Resource> = {
  invoice: "invoices",
  quote: "invoices",
  einvoice: "invoices",
  einvoice_inbox: "invoices",
  customer: "customers",
  product: "products",
  expense: "expenses",
};

activity.get("/", (c) => {
  const user = c.get("user");
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") || "50", 10) || 50), 200);

  // An admin sees the whole log. Everyone else sees the entries about records
  // they may read, and gets an empty list rather than a 403 when that is none.
  const resourceTypes = user.is_admin
    ? undefined
    : Object.keys(RESOURCE_FOR_TYPE).filter((type) =>
        hasPermission(user, RESOURCE_FOR_TYPE[type]!, "read"),
      );

  const data = listActivity({
    user_id: c.req.query("user_id"),
    resource_type: c.req.query("resource_type"),
    action: c.req.query("action"),
    date_from: c.req.query("date_from"),
    date_to: c.req.query("date_to"),
    resource_types: resourceTypes,
    page,
    limit,
  });
  return c.json({ success: true, data });
});

activity.get("/resource/:type/:id", (c) => {
  const user = c.get("user");
  const type = c.req.param("type");
  const resource = RESOURCE_FOR_TYPE[type];
  if (!user.is_admin && !(resource && hasPermission(user, resource, "read"))) {
    return c.json({ success: false, error: "Forbidden" }, 403);
  }
  const entries = getResourceActivity(type, c.req.param("id"));
  return c.json({ success: true, data: entries });
});

export { activity };
