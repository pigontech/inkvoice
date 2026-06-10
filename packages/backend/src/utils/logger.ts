import { AsyncLocalStorage } from "node:async_hooks";
import pino from "pino";

export interface RequestContext {
  request_id: string;
  tenant_id?: string;
  user_id?: string;
  route?: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContextStorage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

const isProd = process.env.NODE_ENV === "production";

const baseLogger = pino({
  level: process.env.LOG_LEVEL || (isProd ? "info" : "debug"),
  // JSON output everywhere — no pretty transport dep. In dev, pipe through
  // `bun run dev | pino-pretty` if you want colored output.
  // Inject the active request context into every log line automatically.
  mixin() {
    const ctx = requestContextStorage.getStore();
    return ctx ? { ...ctx } : {};
  },
  // Drop fields that commonly leak PII out of breadcrumbs.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "password_hash",
      "smtp_password",
      "encrypted_password",
    ],
    censor: "[REDACTED]",
  },
});

export const logger = baseLogger;

/**
 * Lightweight namespaced logger — `logger.child({module: "scheduler"})`-style
 * but without paying for a full child every time.
 */
export function loggerFor(module: string): pino.Logger {
  return baseLogger.child({ module });
}
