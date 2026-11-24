import { Hono } from "hono";
import { hasPermission } from "../middleware/auth";
import { listTags } from "../services/tag.service";

const tags = new Hono();

// All tags with usage counts — feeds tag filter suggestions and autocomplete.
// Tags sit on invoices, customers, products and expenses, so reading any of
// those is enough to see the tag names.
tags.get("/", (c) => {
  const user = c.get("user");
  const mayRead = (["invoices", "customers", "products", "expenses"] as const).some((r) =>
    hasPermission(user, r, "read"),
  );
  if (!mayRead) return c.json({ success: false, error: "Forbidden" }, 403);
  return c.json({ success: true, data: listTags() });
});

export { tags };
