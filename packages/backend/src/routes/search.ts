import { Hono } from "hono";
import { type SearchKind, search } from "../services/search.service";

const searchRoutes = new Hono();

const validKinds: readonly SearchKind[] = ["invoice", "customer", "product"];

searchRoutes.get("/", (c) => {
  const q = c.req.query("q") ?? "";
  const kindParam = c.req.query("kind");
  const kind: SearchKind | undefined = (validKinds as string[]).includes(kindParam ?? "")
    ? (kindParam as SearchKind)
    : undefined;
  const limitParam = parseInt(c.req.query("limit") ?? "20", 10);
  const limit = Number.isFinite(limitParam) ? limitParam : 20;

  const hits = search(q, { kind, limit });
  return c.json({ success: true, data: { hits } });
});

export { searchRoutes };
