import type { Context, Next } from "hono";
import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from "prom-client";

const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new Counter({
  name: "inkvoice_http_requests_total",
  help: "Total HTTP requests by route, method and status",
  labelNames: ["route", "method", "status"] as const,
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: "inkvoice_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["route", "method"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const planLimitBlocks = new Counter({
  name: "inkvoice_plan_limit_blocks_total",
  help: "Plan-limit-blocked create operations",
  labelNames: ["resource"] as const,
  registers: [registry],
});

export const tenantsActive = new Gauge({
  name: "inkvoice_tenants_active",
  help: "Number of active tenants",
  registers: [registry],
});

export const dbPoolSize = new Gauge({
  name: "inkvoice_db_pool_size",
  help: "Number of tenant DBs currently held open in the connection pool",
  registers: [registry],
});

export const dbPoolMisses = new Counter({
  name: "inkvoice_db_pool_misses_total",
  help: "Connection pool misses (cold opens)",
  registers: [registry],
});

export const schedulerRunDuration = new Histogram({
  name: "inkvoice_scheduler_run_duration_seconds",
  help: "Platform scheduler full-pass duration",
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [registry],
});

export const signupsTotal = new Counter({
  name: "inkvoice_signups_total",
  help: "Tenant signup outcomes",
  labelNames: ["outcome"] as const, // "started", "verified", "expired", "rate_limited"
  registers: [registry],
});

export const webhookDeliveriesTotal = new Counter({
  name: "inkvoice_webhook_deliveries_total",
  help: "Outbound webhook delivery outcomes",
  labelNames: ["status"] as const, // "delivered", "failed", "retried"
  registers: [registry],
});

// Extension point: a deployment can register a callback that refreshes its
// dynamic gauges (e.g. tenantsActive, dbPoolSize) right before each scrape.
type MetricsRefresher = () => void | Promise<void>;

let metricsRefresher: MetricsRefresher | null = null;

export function setMetricsRefresher(fn: MetricsRefresher | null): void {
  metricsRefresher = fn;
}

const SILENT_PATHS = new Set(["/metrics", "/health"]);

/** Counts every request via Counter+Histogram. Skip noisy infra paths. */
export async function metricsMiddleware(c: Context, next: Next): Promise<void> {
  const path = c.req.path;
  if (SILENT_PATHS.has(path)) {
    await next();
    return;
  }

  const start = performance.now();
  await next();
  const duration_s = (performance.now() - start) / 1000;
  const route = c.req.routePath || path;

  httpRequestsTotal.inc({ route, method: c.req.method, status: String(c.res.status) });
  httpRequestDuration.observe({ route, method: c.req.method }, duration_s);
}

/** /metrics endpoint. Disabled unless METRICS_TOKEN is set; then Bearer-auth gated. */
export async function metricsRoute(c: Context): Promise<Response> {
  const expected = process.env.METRICS_TOKEN;
  // Fail closed: when no token is configured the endpoint is treated as absent,
  // so metrics are never exposed unauthenticated.
  if (!expected) {
    return c.json({ error: "Not found" }, 404);
  }
  const auth = c.req.header("authorization") || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (provided !== expected) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Refresh dynamic gauges before scrape.
  if (metricsRefresher) {
    try {
      await metricsRefresher();
    } catch {
      // a failing refresher must never break the scrape itself
    }
  }

  const body = await registry.metrics();
  return new Response(body, {
    headers: { "Content-Type": registry.contentType },
  });
}

export { registry as metricsRegistry };
