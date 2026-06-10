import type { Context, Next } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { apiTokenScopeMiddleware } from "./middleware/api-token-scope";
import { authMiddleware } from "./middleware/auth";
import { errorHandler } from "./middleware/error-handler";
import { metricsMiddleware, metricsRoute } from "./middleware/metrics";
import { requestContextMiddleware } from "./middleware/request-context";
import { securityHeaders } from "./middleware/security";
import { activity } from "./routes/activity";
import { apiTokens } from "./routes/api-tokens";
import { auth } from "./routes/auth";
import { customers } from "./routes/customers";
import { dashboard } from "./routes/dashboard";
import { exchangeRate } from "./routes/exchange-rate";
import { expenses } from "./routes/expenses";
import { exportRoutes } from "./routes/export";
import { feedback } from "./routes/feedback";
import { healthRoute } from "./routes/health";
import { invoices } from "./routes/invoices";
import { outgoingWebhooks } from "./routes/outgoing-webhooks";
import { products } from "./routes/products";
import { publicRoutes } from "./routes/public";
import { quotes } from "./routes/quotes";
import { recurring } from "./routes/recurring";
import { reminders } from "./routes/reminders";
import { reports } from "./routes/reports";
import { searchRoutes } from "./routes/search";
import { settings } from "./routes/settings";
import { tax } from "./routes/tax";
import { templates } from "./routes/templates";
import { users } from "./routes/users";
import { webhooks } from "./routes/webhooks";
import { getEnv } from "./utils/env";
import { initXmlProfiles } from "./xml/init";

export interface CreateAppOptions {
  /** Middleware to run before all other middleware (e.g. tenant resolution) */
  // biome-ignore lint/suspicious/noConfusingVoidType: mirrors Hono's MiddlewareHandler return type
  preMiddleware?: Array<(c: Context, next: Next) => Promise<void | Response>>;
  /** Additional route registrations to run after core routes are set up */
  registerRoutes?: (app: Hono) => void;
}

export function createApp(options?: CreateAppOptions): Hono {
  initXmlProfiles();

  const app = new Hono();

  // Request context (request_id, ALS for logging) — must be first.
  app.use("*", requestContextMiddleware);

  // Metrics (counts every request including ones that 4xx/5xx).
  app.use("*", metricsMiddleware);

  // Pre-middleware (e.g. tenant resolution in a multi-tenant overlay)
  if (options?.preMiddleware) {
    for (const mw of options.preMiddleware) {
      app.use("*", mw);
    }
  }

  // Global middleware
  app.use("*", securityHeaders);
  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return origin;
        const env = getEnv();
        // Disallowed origins get no Access-Control-Allow-Origin header at all
        // (returning a fallback origin would just be confusing in DevTools).
        return env.ALLOWED_ORIGINS.includes(origin) ? origin : null;
      },
      credentials: true,
    }),
  );
  app.onError(errorHandler);

  // API responses must never be cached by browsers or proxies — a cached
  // error (e.g. a 404 captured for a URL while logged out) would otherwise
  // be replayed forever. Static assets keep their own long-lived headers.
  app.use("/api/*", async (c: Context, next: Next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });

  // Unknown /api/* paths (including trailing-slash variants of real routes)
  // must honour the JSON error contract instead of Hono's default 404 body.
  app.notFound((c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.json({ success: false, error: "Not found" }, 404);
    }
    return c.text("404 Not Found", 404);
  });

  // Request body size limit (10MB)
  app.use("*", async (c: Context, next: Next) => {
    const contentLength = parseInt(c.req.header("content-length") || "0", 10);
    if (contentLength > 10 * 1024 * 1024) {
      return c.json({ success: false, error: "Request too large" }, 413);
    }
    await next();
  });

  // Health check (deep — checks DB connectivity, scheduler heartbeat, etc.)
  app.get("/health", healthRoute);

  // Metrics scrape endpoint. Disabled (404) unless METRICS_TOKEN is set; then Bearer-gated.
  app.get("/metrics", metricsRoute);

  // Public routes (no auth required)
  app.route("/api/v1/auth", auth);
  app.route("/api/v1/public", publicRoutes);
  app.route("/api/v1/webhooks", webhooks);

  // Additional routes registered by an overlay (e.g. OAuth, billing)
  if (options?.registerRoutes) {
    options.registerRoutes(app);
  }

  // Protected routes (auth required)
  app.use("/api/v1/*", authMiddleware);
  // Enforce per-token scopes (no-op for session auth).
  app.use("/api/v1/*", apiTokenScopeMiddleware);

  // Admin-only routes
  const adminOnly = async (c: Context, next: Next) => {
    const user = c.get("user");
    if (!user?.is_admin) return c.json({ success: false, error: "Forbidden" }, 403);
    await next();
  };
  app.use("/api/v1/users/*", adminOnly);
  app.use("/api/v1/users", adminOnly);
  app.use("/api/v1/settings/*", adminOnly);
  app.use("/api/v1/settings", adminOnly);
  app.use("/api/v1/export/*", adminOnly);
  app.use("/api/v1/export", adminOnly);

  app.route("/api/v1/invoices", invoices);
  app.route("/api/v1/quotes", quotes);
  app.route("/api/v1/customers", customers);
  app.route("/api/v1/products", products);
  app.route("/api/v1/expenses", expenses);
  app.route("/api/v1/exchange-rate", exchangeRate);
  app.route("/api/v1/tax-definitions", tax);
  app.route("/api/v1/settings", settings);
  app.route("/api/v1/users", users);
  app.route("/api/v1/templates", templates);
  app.route("/api/v1/dashboard", dashboard);
  app.route("/api/v1/recurring-invoices", recurring);
  app.route("/api/v1/reports", reports);
  app.route("/api/v1/search", searchRoutes);
  app.route("/api/v1/reminder-rules", reminders);
  app.route("/api/v1/activity", activity);
  app.route("/api/v1/feedback", feedback);
  app.route("/api/v1/export", exportRoutes);
  app.route("/api/v1/outgoing-webhooks", outgoingWebhooks);
  app.route("/api/v1/api-tokens", apiTokens);

  return app;
}
