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
  CHROME_PATH: string;
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
}

let cachedEnv: Env | null = null;

export function resetEnvCache(): void {
  cachedEnv = null;
}

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  cachedEnv = {
    ADMIN_USER: process.env.ADMIN_USER || "admin",
    ADMIN_PASS: (() => {
      const pass = process.env.ADMIN_PASS;
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
    CHROME_PATH: process.env.CHROME_PATH || "",
    DEMO_MODE: process.env.DEMO_MODE === "true",
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
  };

  return cachedEnv;
}
