import { logger } from "./logger";

export interface Env {
  ADMIN_USER: string;
  ADMIN_PASS: string;
  JWT_SECRET: string;
  DATABASE_PATH: string;
  PORT: number;
  HOST: string;
  SESSION_TTL: number;
  COOKIE_SECURE: boolean;
  ENABLE_HSTS: boolean;
  RATE_LIMIT_ENABLED: boolean;
  RATE_LIMIT_MAX_ATTEMPTS: number;
  RATE_LIMIT_WINDOW: number;
  DEMO_MODE: boolean;
  DEMO_RESET_INTERVAL: number;
  ALLOWED_ORIGINS: string[];
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER: string;
  SMTP_PASS: string;
  SMTP_FROM: string;
  SMTP_SECURE: boolean;
  STRIPE_SECRET_KEY: string;
  STRIPE_PUBLISHABLE_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  PAYPAL_CLIENT_ID: string;
  PAYPAL_SECRET: string;
  PAYPAL_WEBHOOK_ID: string;
  /** "sandbox" (default) or "live". */
  PAYPAL_ENV: string;
  SLACK_WEBHOOK_URL: string;
  OIDC_ISSUER_URL: string;
  OIDC_CLIENT_ID: string;
  OIDC_CLIENT_SECRET: string;
  OIDC_SCOPE: string;
  OIDC_ALLOWED_DOMAINS: string[];
  OIDC_AUTO_PROVISION: boolean;
  OIDC_PROVIDER_NAME: string;
  PUBLIC_BASE_URL: string;
  OIDC_ENABLED: boolean;
  /** Days a mobile device session stays valid without use (sliding). */
  DEVICE_SESSION_IDLE_DAYS: number;
}

/**
 * Well-known throwaway credentials for public demo instances. A visitor has to
 * be able to sign in, so DEMO_MODE defaults the admin account to these and the
 * login page advertises them (see routes/public.ts → GET /public/config).
 */
export const DEMO_ADMIN_USER = "demo";
export const DEMO_ADMIN_PASS = "demo";

let cachedEnv: Env | null = null;

export function resetEnvCache(): void {
  cachedEnv = null;
}

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  // Read up front: properties below can't see their siblings mid-literal, and
  // DEMO_MODE changes what the admin defaults are.
  const demoMode = process.env.DEMO_MODE === "true";

  cachedEnv = {
    ADMIN_USER: process.env.ADMIN_USER || (demoMode ? DEMO_ADMIN_USER : "admin"),
    ADMIN_PASS: (() => {
      const pass = process.env.ADMIN_PASS;
      // A demo falling back to its throwaway password is deliberate, so the
      // production warning would just be noise. A demo that sets a password
      // still gets warned if it's a known-weak one.
      if (demoMode && !pass) return DEMO_ADMIN_PASS;
      if (!pass || pass === "changeme") {
        logger.warn("WARNING: Using default admin password. Set ADMIN_PASS for production.");
      }
      return pass || "changeme";
    })(),
    JWT_SECRET: (() => {
      const secret = process.env.JWT_SECRET;
      if (!secret && process.env.NODE_ENV === "production") {
        throw new Error("FATAL: JWT_SECRET environment variable must be set in production");
      }
      if (secret && secret.length < 32) {
        throw new Error("FATAL: JWT_SECRET must be at least 32 characters");
      }
      return secret || "dev-secret-key-change-in-production-min-32-chars";
    })(),
    DATABASE_PATH: process.env.DATABASE_PATH || "./data/invoice.db",
    PORT: parseInt(process.env.PORT || "3000", 10),
    HOST: process.env.HOST || "0.0.0.0",
    SESSION_TTL: parseInt(process.env.SESSION_TTL || "3600", 10),
    COOKIE_SECURE: process.env.COOKIE_SECURE !== "false",
    ENABLE_HSTS: process.env.ENABLE_HSTS === "true",
    RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED !== "false",
    RATE_LIMIT_MAX_ATTEMPTS: parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS || "5", 10),
    RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW || "900", 10),
    DEMO_MODE: demoMode,
    DEMO_RESET_INTERVAL: parseInt(process.env.DEMO_RESET_INTERVAL || "86400000", 10),
    ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:3000")
      .split(",")
      .map((s) => s.trim()),
    SMTP_HOST: process.env.SMTP_HOST || "",
    SMTP_PORT: parseInt(process.env.SMTP_PORT || "587", 10),
    SMTP_USER: process.env.SMTP_USER || "",
    SMTP_PASS: process.env.SMTP_PASS || "",
    SMTP_FROM: process.env.SMTP_FROM || "",
    SMTP_SECURE: process.env.SMTP_SECURE === "true",
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || "",
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",
    PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID || "",
    PAYPAL_SECRET: process.env.PAYPAL_SECRET || "",
    PAYPAL_WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID || "",
    PAYPAL_ENV: process.env.PAYPAL_ENV || "sandbox",
    SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL || "",
    OIDC_ISSUER_URL: (() => {
      const raw = (process.env.OIDC_ISSUER_URL || "").trim();
      if (!raw) return "";
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        throw new Error("FATAL: OIDC_ISSUER_URL must be a valid URL");
      }
      if (parsed.protocol !== "https:") {
        throw new Error("FATAL: OIDC_ISSUER_URL must use https");
      }
      if (parsed.username || parsed.password) {
        throw new Error("FATAL: OIDC_ISSUER_URL must not contain credentials");
      }
      return raw.replace(/\/+$/, "");
    })(),
    OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID || "",
    OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET || "",
    OIDC_SCOPE: process.env.OIDC_SCOPE || "openid email profile",
    OIDC_ALLOWED_DOMAINS: (process.env.OIDC_ALLOWED_DOMAINS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    OIDC_AUTO_PROVISION: process.env.OIDC_AUTO_PROVISION !== "false",
    OIDC_PROVIDER_NAME: process.env.OIDC_PROVIDER_NAME || "",
    OIDC_ENABLED: (() => {
      // Computed last so it can see the values above. Presence of the issuer
      // enables SSO; a half-configured client is a boot-time error, never a
      // silent login-page surprise.
      const issuer = process.env.OIDC_ISSUER_URL || "";
      if (!issuer) return false;
      if (!process.env.OIDC_CLIENT_ID || !process.env.OIDC_CLIENT_SECRET) {
        throw new Error(
          "FATAL: OIDC_ISSUER_URL is set but OIDC_CLIENT_ID/OIDC_CLIENT_SECRET are missing",
        );
      }
      return true;
    })(),
    PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
    DEVICE_SESSION_IDLE_DAYS: (() => {
      const days = parseInt(process.env.DEVICE_SESSION_IDLE_DAYS || "90", 10);
      return Number.isFinite(days) && days > 0 ? days : 90;
    })(),
  };

  return cachedEnv;
}
