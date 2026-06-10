import type { Context, Next } from "hono";

// Resources an API token can be scoped to. These are the integration-relevant
// REST surfaces; anything not listed here (settings, users, dashboard, …) is
// off-limits to a *scoped* token. The first path segment after /api/v1/ is
// matched against these keys.
export const API_SCOPE_RESOURCES = [
  "invoices",
  "customers",
  "quotes",
  "products",
  "expenses",
] as const;

export const API_SCOPE_ACTIONS = ["read", "write"] as const;

export type ApiScopeResource = (typeof API_SCOPE_RESOURCES)[number];

const RESOURCE_SET = new Set<string>(API_SCOPE_RESOURCES);

function actionForMethod(method: string): "read" | "write" {
  return method === "GET" || method === "HEAD" ? "read" : "write";
}

/**
 * Enforces API-token scopes. A no-op for session (cookie/JWT) auth — it only
 * acts when the request was authenticated with an API token. A token with an
 * empty scope list is a full-access token and behaves as its owner; a token
 * with scopes may only touch the resources/actions it was granted.
 */
export async function apiTokenScopeMiddleware(c: Context, next: Next) {
  const apiToken = c.get("apiToken");
  if (!apiToken || apiToken.scopes.length === 0) {
    return next();
  }

  // Path shape is /api/v1/<resource>/...
  const resource = c.req.path.split("/")[3];
  if (!RESOURCE_SET.has(resource)) {
    return c.json({ success: false, error: "API token is not permitted for this resource" }, 403);
  }

  const action = actionForMethod(c.req.method);
  // A write grant implies read on the same resource.
  const allowed =
    apiToken.scopes.includes(`${resource}:${action}`) ||
    (action === "read" && apiToken.scopes.includes(`${resource}:write`));

  if (!allowed) {
    return c.json(
      { success: false, error: `API token is missing the '${resource}:${action}' scope` },
      403,
    );
  }

  return next();
}
