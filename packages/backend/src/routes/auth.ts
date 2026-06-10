import crypto from "node:crypto";
import { type Context, Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { getDb } from "../database/connection";
import { authMiddleware } from "../middleware/auth";
import { bucketRateLimiter, rateLimiter } from "../middleware/rate-limiter";
import { logActivity } from "../services/activity.service";
import { getCurrentUser, login } from "../services/auth.service";
import { sendEmail } from "../services/email.service";
import { passwordResetEmail } from "../services/email-templates";
import { getSystemMailSender } from "../services/system-mail";
import { getEnv } from "../utils/env";
import { hashPassword } from "../utils/password";

// Extension point: a deployment can override how password-reset links are
// built (e.g. per-tenant subdomains). Returning null falls back to the
// default PUBLIC_BASE_URL-based link.
type ResetUrlBuilder = (c: Context, token: string) => string | null;

let resetUrlBuilder: ResetUrlBuilder | null = null;

export function setResetUrlBuilder(fn: ResetUrlBuilder | null): void {
  resetUrlBuilder = fn;
}

const auth = new Hono();

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

auth.post("/login", rateLimiter, async (c) => {
  const body = await c.req.json();
  const parsed = loginSchema.parse(body);

  // A multi-tenant deployment's middleware sets c.get("tenant"). Bind the
  // issued token to that tenant so it can't be replayed against another
  // subdomain.
  const tenant = c.get("tenant") as { id: string } | undefined;
  const result = await login(parsed.username, parsed.password, tenant?.id);
  if (!result) {
    return c.json({ success: false, error: "Invalid credentials" }, 401);
  }

  const env = getEnv();
  // Strict locks the cookie to same-site requests, defeating CSRF on
  // mutating endpoints. The auth cookie isn't read on cross-site links —
  // bookmarks and direct navigations still work because Strict applies to
  // top-level navigations the same way as Lax for already-set cookies.
  setCookie(c, "session", result.token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "Strict",
    maxAge: env.SESSION_TTL,
    path: "/",
  });

  logActivity({
    user_id: result.user.id,
    user_name: result.user.username,
    action: "login",
    resource_type: "user",
    resource_id: result.user.id,
  });
  return c.json({ success: true, data: result });
});

auth.post("/logout", (c) => {
  deleteCookie(c, "session", { path: "/" });
  return c.json({ success: true });
});

// Forgot-password: ALWAYS returns 202 to avoid leaking whether an email is
// registered. Rate-limited per IP. The token is opaque (32 bytes hex) and
// is stored only in the tenant DB; no copy in logs or response.
const forgotSchema = z.object({ email: z.string().email() });

auth.post("/forgot-password", bucketRateLimiter("forgot-password", 3, 3600), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = forgotSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: true }, 202); // don't reveal validation issues either
  }

  const db = getDb();
  const user = db
    .query("SELECT id, email, username FROM users WHERE email = ? AND is_active = 1")
    .get(parsed.data.email) as { id: string; email: string; username: string } | null;

  if (user?.email) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.run("INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)", [
      token,
      user.id,
      expiresAt,
    ]);

    // Deliberately no request-origin fallback: deriving the link base from
    // the Host header would enable reset-link poisoning.
    const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
    const resetUrl = resetUrlBuilder?.(c, token) ?? `${base}/reset-password?token=${token}`;

    const sendMail = getSystemMailSender();
    if (sendMail) {
      // A registered platform sender (e.g. a hosted deployment) owns delivery.
      await sendMail({
        to: user.email,
        template: "password-reset",
        locale: "en",
        vars: { email: user.email, resetUrl },
      });
    } else {
      // Standalone install: deliver through the configured SMTP server. When
      // SMTP isn't configured this fails quietly — still 202, never leaking
      // whether the address exists.
      await sendEmail({
        to: user.email,
        ...passwordResetEmail({ email: user.email, reset_url: resetUrl }),
      });
    }
  }

  return c.json(
    { success: true, data: { message: "If this email is registered, a reset link was sent." } },
    202,
  );
});

const resetSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(12, "Password must be at least 12 characters"),
});

auth.post("/reset-password", bucketRateLimiter("reset-password", 10, 3600), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = resetSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false, error: "Validation failed", details: parsed.error.flatten() },
      400,
    );
  }

  const db = getDb();
  const row = db
    .query("SELECT user_id, expires_at, consumed_at FROM password_reset_tokens WHERE token = ?")
    .get(parsed.data.token) as {
    user_id: string;
    expires_at: string;
    consumed_at: string | null;
  } | null;

  if (!row || row.consumed_at) {
    return c.json({ success: false, error: "Invalid or already-used token" }, 410);
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return c.json({ success: false, error: "Token expired" }, 410);
  }

  const newHash = await hashPassword(parsed.data.password);
  db.transaction(() => {
    db.run("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?", [
      newHash,
      row.user_id,
    ]);
    db.run("UPDATE password_reset_tokens SET consumed_at = datetime('now') WHERE token = ?", [
      parsed.data.token,
    ]);
    // Invalidate any other outstanding reset tokens for this user.
    db.run(
      "UPDATE password_reset_tokens SET consumed_at = datetime('now') WHERE user_id = ? AND consumed_at IS NULL",
      [row.user_id],
    );
  })();

  logActivity({
    user_id: row.user_id,
    user_name: "",
    action: "password_reset",
    resource_type: "user",
    resource_id: row.user_id,
  });

  return c.json({ success: true });
});

auth.get("/me", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const user = getCurrentUser(userId);
  if (!user) {
    return c.json({ success: false, error: "User not found" }, 404);
  }
  // Surface impersonation state so the SPA can render the banner.
  const payload = c.get("user") as
    | { impersonator_id?: string; impersonation_reason?: string }
    | undefined;
  const impersonation = payload?.impersonator_id
    ? { impersonator_id: payload.impersonator_id, reason: payload.impersonation_reason ?? null }
    : null;
  return c.json({ success: true, data: { ...user, impersonation } });
});

export { auth };
