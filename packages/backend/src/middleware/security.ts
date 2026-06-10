import type { Context, Next } from "hono";
import { getEnv } from "../utils/env";

export async function securityHeaders(c: Context, next: Next) {
  const env = getEnv();

  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;",
  );

  if (env.ENABLE_HSTS) {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  await next();
}
