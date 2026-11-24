import { Hono } from "hono";
import { hasPermission } from "../middleware/auth";
import { type SearchKind, search } from "../services/search.service";
import type { Resource } from "../types/user";

const searchRoutes = new Hono();

const validKinds: readonly SearchKind[] = ["invoice", "customer", "product"];

const RESOURCE_FOR_KIND: Record<SearchKind, Resource> = {
  invoice: "invoices",
  customer: "customers",
  product: "products",
};

searchRoutes.get("/", (c) => {
  // Search only looks through the kinds of record the caller may read.
  const user = c.get("user");
  const kinds = validKinds.filter((k) => hasPermission(user, RESOURCE_FOR_KIND[k], "read"));
  if (kinds.length === 0) return c.json({ success: false, error: "Forbidden" }, 403);

  const q = c.req.query("q") ?? "";
  const kindParam = c.req.query("kind");
  const kind: SearchKind | undefined = (validKinds as string[]).includes(kindParam ?? "")
    ? (kindParam as SearchKind)
    : undefined;
  const limitParam = parseInt(c.req.query("limit") ?? "20", 10);
  const limit = Number.isFinite(limitParam) ? limitParam : 20;

  const hits = search(q, { kind, kinds, limit });
  return c.json({ success: true, data: { hits } });
});

export { searchRoutes };
