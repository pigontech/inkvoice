import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { serve } from "bun";
import type { Hono } from "hono";
import { createApp } from "./app";
import { closeDatabase, initDatabase } from "./database/connection";
import { runMigrations } from "./database/migrations";
import { seed } from "./database/seed";
import { startScheduler, stopScheduler } from "./services/scheduler";
import { getEnv } from "./utils/env";
import { logger } from "./utils/logger";
import { flushSentry, initSentry } from "./utils/sentry";

/**
 * Serve the SPA + API for a prepared app and handle graceful shutdown.
 * Exported so a downstream overlay can boot its own composed app through the
 * same server plumbing; the standalone boot at the bottom of this file uses
 * it with the stock single-tenant app.
 */
export async function startServer(app: Hono, shutdownFn: () => void): Promise<void> {
  const env = getEnv();

  // Serve frontend static files in production
  const frontendDist = join(import.meta.dir, "../../frontend/dist");
  if (existsSync(frontendDist)) {
    const indexHtml = join(frontendDist, "index.html");

    // Serve static assets (JS, CSS, fonts, images)
    // Vite emits content-hashed filenames under /assets, so they are immutable
    // and safe to cache aggressively for a year.
    const resolvedDist = resolve(frontendDist);
    app.get("/assets/*", async (c) => {
      const filePath = resolve(frontendDist, `.${c.req.path}`);
      if (!filePath.startsWith(resolvedDist)) {
        return c.notFound();
      }
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }
      return c.notFound();
    });

    // Files copied from public/ live at the dist root (favicon, manifest, sw,
    // robots…). Serve them directly so browsers and the install banner can
    // fetch them with the correct MIME type — without this, the SPA fallback
    // below would hand back index.html for every request.
    const ROOT_FILE_PATTERN = /^\/[^/]+\.[A-Za-z0-9]+$/;
    app.get("*", async (c, next) => {
      const path = c.req.path;
      if (!ROOT_FILE_PATTERN.test(path)) return next();
      if (path.startsWith("/api/")) return next();
      const filePath = resolve(frontendDist, `.${path}`);
      if (!filePath.startsWith(resolvedDist) || filePath === indexHtml) return next();
      const file = Bun.file(filePath);
      if (!(await file.exists())) return next();
      // The service worker must not be cached or browsers would never see
      // updated versions.
      const noCache = path === "/sw.js";
      return new Response(file, {
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "Cache-Control": noCache ? "no-cache" : "public, max-age=3600",
        },
      });
    });

    // SPA fallback — serve index.html for all non-API routes.
    // index.html must not be cached so the latest asset hashes are picked up.
    app.get("*", async (c) => {
      const path = c.req.path;
      if (path.startsWith("/api/") || path === "/health") {
        return c.notFound();
      }
      return new Response(Bun.file(indexHtml), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    });

    logger.info({ frontendDist }, "Serving frontend");
  }

  logger.info({ host: env.HOST, port: env.PORT }, "Server starting");

  const server = serve({
    fetch: app.fetch,
    port: env.PORT,
    hostname: env.HOST,
  });

  logger.info({ url: `http://${env.HOST}:${env.PORT}` }, "Server running");

  // Graceful shutdown.
  //
  // Strategy:
  //   1. Stop accepting new connections (server.stop()).
  //   2. Wait up to GRACEFUL_SHUTDOWN_MS for in-flight requests to complete.
  //   3. Run user-provided shutdownFn (close DBs, stop scheduler).
  //   4. Exit.
  //
  // A second signal (e.g. impatient operator pressing Ctrl-C twice) bypasses
  // the drain and exits immediately.
  const GRACEFUL_SHUTDOWN_MS = 30_000;
  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) {
      logger.info({ signal }, "Signal received again — exiting immediately.");
      process.exit(1);
    }
    shuttingDown = true;
    logger.info(
      { signal, drainSec: GRACEFUL_SHUTDOWN_MS / 1000 },
      "Signal received, draining in-flight requests",
    );

    try {
      // Bun's server.stop() resolves once active connections finish or the
      // process exits. Race it against a hard deadline so we don't hang.
      await Promise.race([
        Promise.resolve(server.stop?.()),
        new Promise((resolve) => setTimeout(resolve, GRACEFUL_SHUTDOWN_MS)),
      ]);
    } catch (err) {
      logger.error({ err }, "Error stopping server");
    }

    try {
      shutdownFn();
    } catch (err) {
      logger.error({ err }, "Error in shutdownFn");
    }

    // Flush any pending Sentry events before exit. No-op if Sentry isn't initialised.
    await flushSentry(2000);

    logger.info("Goodbye.");
    process.exit(0);
  }

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

// Standalone boot. A downstream overlay never reaches this block — it imports
// startServer above and supplies its own composed app instead.
if (import.meta.main) {
  // Initialise Sentry first so init/migration crashes are captured. No-op
  // without SENTRY_DSN.
  await initSentry();

  initDatabase();
  runMigrations();
  await seed();
  startScheduler();

  await startServer(createApp(), () => {
    stopScheduler();
    closeDatabase();
  });
}
