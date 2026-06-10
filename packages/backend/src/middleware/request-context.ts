import crypto from "node:crypto";
import type { Context, Next } from "hono";
import { logger, type RequestContext, runWithRequestContext } from "../utils/logger";

declare module "hono" {
  interface ContextVariableMap {
    request_id: string;
  }
}

/**
 * Sets a request_id on the Hono context, runs the rest of the request inside
 * an AsyncLocalStorage with a {request_id, tenant_id, user_id} context, and
 * emits one structured log line per request once the response is complete.
 *
 * Must be the FIRST middleware so subsequent middleware (auth, tenant) can
 * augment the same context.
 */
export async function requestContextMiddleware(c: Context, next: Next): Promise<void> {
  const incoming = c.req.header("x-request-id");
  const requestId =
    incoming && /^[a-zA-Z0-9-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
  c.set("request_id", requestId);
  c.header("X-Request-Id", requestId);

  const ctx: RequestContext = { request_id: requestId };

  await runWithRequestContext(ctx, async () => {
    const start = performance.now();
    try {
      await next();
    } finally {
      // Pull tenant + user info that downstream middleware may have added.
      const tenant = c.get("tenant" as never) as { id: string } | undefined;
      if (tenant) ctx.tenant_id = tenant.id;
      const userId = (c.get as (k: string) => unknown)("userId");
      if (typeof userId === "string") ctx.user_id = userId;
      ctx.route = c.req.routePath || c.req.path;

      const duration_ms = Math.round(performance.now() - start);
      const status = c.res.status;
      // 5xx → error level; 4xx → warn; 2xx/3xx → info. Healthchecks and
      // /metrics are silenced because they fire constantly.
      const path = c.req.path;
      if (path !== "/health" && path !== "/metrics") {
        const fields = {
          method: c.req.method,
          route: ctx.route,
          status,
          duration_ms,
        };
        if (status >= 500) logger.error(fields, "request");
        else if (status >= 400) logger.warn(fields, "request");
        else logger.info(fields, "request");
      }
    }
  });
}
