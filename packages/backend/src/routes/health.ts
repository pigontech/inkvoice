import type { Context } from "hono";

export interface HealthCheck {
  ok: boolean;
  detail?: string;
}

export type HealthCheckFn = () => Promise<HealthCheck>;

interface HealthResponse {
  status: "ok" | "degraded" | "unhealthy";
  checks: Record<string, HealthCheck>;
  timestamp: string;
}

// Extension point: a deployment can replace the default database check with
// its own platform checks (registered at boot) — mirrors setSystemMailSender,
// setTenantSmtpResolver, and setRecurringLimitChecker.
let registeredHealthChecks: Record<string, HealthCheckFn> | null = null;

export function setHealthChecks(checks: Record<string, HealthCheckFn> | null): void {
  registeredHealthChecks = checks;
}

async function checkSelfHostedDb(): Promise<HealthCheck> {
  try {
    const { getDb } = await import("../database/connection");
    const db = getDb();
    db.query("SELECT 1").get();
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function healthRoute(c: Context): Promise<Response> {
  const checks: Record<string, HealthCheck> = {};

  if (registeredHealthChecks) {
    for (const [name, check] of Object.entries(registeredHealthChecks)) {
      checks[name] = await check();
    }
  } else {
    checks.database = await checkSelfHostedDb();
  }

  const failedCount = Object.values(checks).filter((c) => !c.ok).length;
  const status: HealthResponse["status"] =
    failedCount === 0
      ? "ok"
      : failedCount === Object.keys(checks).length
        ? "unhealthy"
        : "degraded";

  const httpStatus = status === "unhealthy" ? 503 : 200;
  return c.json(
    {
      status,
      checks,
      timestamp: new Date().toISOString(),
    } satisfies HealthResponse,
    httpStatus,
  );
}
