import type { Transporter } from "nodemailer";
import { getEnv } from "../utils/env";

// `nodemailer` is heavy to load (~25ms on Bun); defer it until the first
// outgoing email so cold start stays fast for instances that never use SMTP.
//
// A multi-tenant overlay can load per-workspace SMTP credentials by
// registering a resolver via `setTenantSmtpResolver`. Standalone installs
// fall back to the process env (`SMTP_HOST`, `SMTP_USER`, …); if no resolver
// is installed we behave like standalone.

export interface ResolvedSmtp {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  fromAddress?: string;
  fromName?: string;
}

export type TenantSmtpResolver = () => Promise<ResolvedSmtp | null>;

let tenantSmtpResolver: TenantSmtpResolver | null = null;

/** An overlay registers this so per-request sends look up tenant SMTP. */
export function setTenantSmtpResolver(resolver: TenantSmtpResolver | null): void {
  tenantSmtpResolver = resolver;
  // Invalidate any cached transporters when the resolver changes.
  envTransporterPromise = null;
  tenantTransporterCache.clear();
}

// Process-wide cache for the env-based (self-hosted) transporter.
let envTransporterPromise: Promise<Transporter> | null = null;

// Tenant transporter cache. Key = JSON-stringified resolved config so a
// settings change naturally invalidates the entry on the next send.
const tenantTransporterCache = new Map<string, Promise<Transporter>>();

async function buildTransporter(cfg: ResolvedSmtp): Promise<Transporter> {
  const { default: nodemailer } = await import("nodemailer");
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
}

function envSmtpConfig(): ResolvedSmtp | null {
  const env = getEnv();
  if (!env.SMTP_HOST) return null;
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER || undefined,
    pass: env.SMTP_PASS || undefined,
    fromAddress: env.SMTP_FROM || env.SMTP_USER || undefined,
  };
}

async function resolveActiveSmtp(): Promise<ResolvedSmtp | null> {
  if (tenantSmtpResolver) {
    const tenantCfg = await tenantSmtpResolver();
    if (tenantCfg) return tenantCfg;
  }
  return envSmtpConfig();
}

async function getTransporterForActiveContext(): Promise<{
  transporter: Transporter;
  cfg: ResolvedSmtp;
} | null> {
  const cfg = await resolveActiveSmtp();
  if (!cfg) return null;

  // Self-hosted fast path: single env-based transporter cached globally.
  if (!tenantSmtpResolver) {
    if (!envTransporterPromise) envTransporterPromise = buildTransporter(cfg);
    return { transporter: await envTransporterPromise, cfg };
  }

  const cacheKey = JSON.stringify(cfg);
  let promise = tenantTransporterCache.get(cacheKey);
  if (!promise) {
    promise = buildTransporter(cfg);
    tenantTransporterCache.set(cacheKey, promise);
  }
  return { transporter: await promise, cfg };
}

export async function isEmailConfigured(): Promise<boolean> {
  const cfg = await resolveActiveSmtp();
  return !!cfg;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Per-send override for the From header. Falls back to resolved fromAddress/user. */
  from?: string;
  /** Per-send Reply-To header. */
  replyTo?: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const result = await getTransporterForActiveContext();
  if (!result) {
    return { success: false, error: "SMTP is not configured" };
  }

  const { transporter, cfg } = result;
  const from =
    opts.from ||
    (cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddress}>` : cfg.fromAddress) ||
    cfg.user;

  try {
    await transporter.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      replyTo: opts.replyTo,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to send email" };
  }
}

export async function testConnection(): Promise<
  { success: true } | { success: false; error: string }
> {
  const result = await getTransporterForActiveContext();
  if (!result) return { success: false, error: "SMTP is not configured" };
  try {
    await result.transporter.verify();
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "SMTP connection failed" };
  }
}

/**
 * Drop the transporter cache. Call after the tenant updates SMTP settings so
 * the next send picks up the new credentials immediately.
 */
export function resetTransporter(): void {
  envTransporterPromise = null;
  tenantTransporterCache.clear();
}
