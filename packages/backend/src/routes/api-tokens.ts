import { Hono } from "hono";
import { z } from "zod";
import { API_SCOPE_ACTIONS, API_SCOPE_RESOURCES } from "../middleware/api-token-scope";
import { createToken, listTokens, revokeToken } from "../services/api-token.service";

const apiTokens = new Hono();

const scopePattern = new RegExp(
  `^(${API_SCOPE_RESOURCES.join("|")}):(${API_SCOPE_ACTIONS.join("|")})$`,
);

const createSchema = z.object({
  name: z.string().min(1).max(100),
  // Empty/omitted = full-access token (acts as the owner). Otherwise a list of
  // "resource:action" grants validated against the known scope vocabulary.
  scopes: z.array(z.string().regex(scopePattern)).optional(),
});

// Advertises the scope vocabulary so the UI can render checkboxes.
apiTokens.get("/scopes", (c) => {
  return c.json({
    success: true,
    data: { resources: API_SCOPE_RESOURCES, actions: API_SCOPE_ACTIONS },
  });
});

apiTokens.get("/", (c) => {
  return c.json({ success: true, data: listTokens(c.get("userId")) });
});

apiTokens.post("/", async (c) => {
  const { name, scopes } = createSchema.parse(await c.req.json());
  const { token, record } = createToken(c.get("userId"), name, scopes ?? []);
  // `token` is the only time the plain value is ever returned.
  return c.json({ success: true, data: { ...record, token } }, 201);
});

apiTokens.delete("/:id", (c) => {
  const ok = revokeToken(c.req.param("id"), c.get("userId"));
  if (!ok) return c.json({ success: false, error: "Token not found" }, 404);
  return c.json({ success: true });
});

export { apiTokens };
