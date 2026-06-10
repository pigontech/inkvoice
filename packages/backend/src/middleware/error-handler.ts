import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { HttpError } from "../utils/http-error";
import { logger } from "../utils/logger";
import { captureException } from "../utils/sentry";

function zodClientSummary(issues: ZodError["issues"]): string {
  const parts = issues.slice(0, 4).map((issue) => {
    const path = issue.path.filter((p) => typeof p !== "number").join(".");
    const prefix = path ? `${path}: ` : "";
    return `${prefix}${issue.message}`;
  });
  return parts.join("; ");
}

export function errorHandler(err: Error, c: Context) {
  if (err instanceof HttpError) {
    logger.warn({ status: err.status, message: err.message }, "[HttpError]");
    return c.json(
      {
        success: false,
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
        ...(err.errors ? { errors: err.errors } : {}),
      },
      err.status as ContentfulStatusCode,
    );
  }

  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const path = issue.path.map(String).join(".") || "_root";
      if (!fieldErrors[path]) fieldErrors[path] = [];
      fieldErrors[path].push(issue.message);
    }
    return c.json(
      {
        success: false,
        error: zodClientSummary(err.issues),
        code: "VALIDATION_FAILED",
        errors: fieldErrors,
      },
      400,
    );
  }

  logger.error({ err }, "[Error]");
  const tenant = c.get("tenant") as { id?: string } | undefined;
  captureException(err, {
    route: c.req.routePath || c.req.path,
    method: c.req.method,
    tenant_id: tenant?.id,
  });

  if (err instanceof SyntaxError && err.message.includes("JSON")) {
    return c.json(
      { success: false, error: "Invalid JSON in request body", code: "VALIDATION_FAILED" },
      400,
    );
  }

  return c.json({ success: false, error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
}
