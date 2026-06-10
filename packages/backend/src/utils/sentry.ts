// Sentry wiring is opt-in via SENTRY_DSN. When the env var is unset (default
// in OSS / dev), every function here is a cheap no-op so we don't import the
// SDK or pay any runtime cost.

import { logger } from "./logger";

let initialised = false;
let sentryModule: typeof import("@sentry/bun") | null = null;

const PII_KEYS = new Set([
  "email",
  "name",
  "first_name",
  "last_name",
  "phone",
  "address_line1",
  "address_line2",
  "address",
  "tax_id",
  "password",
  "password_hash",
  "credit_card",
  "card_number",
  "cvv",
]);

function scrub(obj: unknown, depth = 0): unknown {
  if (depth > 5 || obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (PII_KEYS.has(k.toLowerCase())) {
      out[k] = "[redacted]";
    } else {
      out[k] = scrub(v, depth + 1);
    }
  }
  return out;
}

export async function initSentry(): Promise<void> {
  if (initialised) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // No-op when unconfigured.

  try {
    sentryModule = await import("@sentry/bun");
    sentryModule.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      release: process.env.SENTRY_RELEASE || undefined,
      // Sample-rate kept conservative; bump after launch when traffic profile is known.
      tracesSampleRate: 0,
      beforeSend(event) {
        // Strip PII from request payload + breadcrumbs.
        if (event.request) {
          if (event.request.data) event.request.data = scrub(event.request.data);
          if (event.request.cookies) event.request.cookies = undefined;
        }
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs.map((b) => ({
            ...b,
            data: b.data ? (scrub(b.data) as Record<string, unknown>) : undefined,
          }));
        }
        // Strip user emails from `user` if Sentry's auto-populated it.
        if (event.user) {
          delete event.user.email;
          delete event.user.username;
        }
        return event;
      },
    });
    initialised = true;
    logger.info({ release: process.env.SENTRY_RELEASE }, "Sentry initialised");
  } catch (err) {
    logger.warn({ err }, "Sentry init failed; continuing without error reporting");
  }
}

export function captureException(err: unknown, tags?: Record<string, string | undefined>): void {
  if (!sentryModule) return;
  if (tags) {
    sentryModule.withScope((scope) => {
      for (const [k, v] of Object.entries(tags)) {
        if (v !== undefined) scope.setTag(k, v);
      }
      sentryModule!.captureException(err);
    });
  } else {
    sentryModule.captureException(err);
  }
}

/** Wrap a function so any sync/async throw goes to Sentry, then re-throws. */
export function withSentry<T extends (...args: any[]) => unknown>(
  fn: T,
  tags?: Record<string, string>,
): T {
  return (async (...args: any[]) => {
    try {
      return await (fn as any)(...args);
    } catch (err) {
      captureException(err, tags);
      throw err;
    }
  }) as unknown as T;
}

export async function flushSentry(timeoutMs = 2000): Promise<boolean> {
  if (!sentryModule) return true;
  return sentryModule.flush(timeoutMs);
}
