import type { Context, Next } from "hono";
import { getEnv } from "../utils/env";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Single in-process Map keyed by `${bucket}:${ip}`. Per the launch spec we
// commit to single-replica deployment; multi-replica would need Redis.
const attempts = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 5 minutes.
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of attempts) {
      if (entry.resetAt <= now) {
        attempts.delete(key);
      }
    }
  },
  5 * 60 * 1000,
);

function clientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown"
  );
}

/**
 * Login-specific limiter: increments on failure, resets on success. Uses
 * RATE_LIMIT_MAX_ATTEMPTS / RATE_LIMIT_WINDOW from env.
 */
export async function rateLimiter(c: Context, next: Next) {
  const env = getEnv();

  if (!env.RATE_LIMIT_ENABLED) {
    await next();
    return;
  }

  const ip = clientIp(c);
  const key = `login:${ip}`;
  const now = Date.now();
  const windowMs = env.RATE_LIMIT_WINDOW * 1000;

  const entry = attempts.get(key);

  if (entry) {
    if (entry.resetAt <= now) {
      attempts.delete(key);
    } else if (entry.count >= env.RATE_LIMIT_MAX_ATTEMPTS) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json(
        { success: false, error: "Too many login attempts. Please try again later." },
        429,
      );
    }
  }

  await next();

  // If login failed (non-2xx), increment counter; on success, clear.
  if (c.res.status >= 400) {
    const existing = attempts.get(key);
    if (existing && existing.resetAt > now) {
      existing.count++;
    } else {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
    }
  } else {
    attempts.delete(key);
  }
}

/**
 * Generic IP-based bucket limiter. Counts every request (regardless of
 * outcome) and rejects with 429 once `max` is exceeded within `windowSec`.
 *
 * Use for endpoints where any traffic — successful or not — should be
 * throttled (signup, password reset, OAuth start). Pre-flight rejection
 * means abusers can't even reach the route handler.
 *
 * @param bucket Stable name used as the cache key prefix. Buckets are
 *   isolated from each other.
 * @param max Maximum requests per IP within the window.
 * @param windowSec Window length in seconds.
 */
export function bucketRateLimiter(bucket: string, max: number, windowSec: number) {
  return async (c: Context, next: Next) => {
    const env = getEnv();
    if (!env.RATE_LIMIT_ENABLED) {
      await next();
      return;
    }

    const ip = clientIp(c);
    const key = `${bucket}:${ip}`;
    const now = Date.now();
    const windowMs = windowSec * 1000;

    const entry = attempts.get(key);
    if (entry && entry.resetAt > now) {
      if (entry.count >= max) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        c.header("Retry-After", String(retryAfter));
        return c.json({ success: false, error: "Too many requests. Please try again later." }, 429);
      }
      entry.count++;
    } else {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
    }

    await next();
  };
}

/** Test-only — clears all bucket counters. */
export function resetRateLimitsForTesting(): void {
  attempts.clear();
}
