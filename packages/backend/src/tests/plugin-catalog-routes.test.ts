import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { unlinkSync } from "node:fs";
import bcrypt from "bcryptjs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { setPluginEntitlementCheck } from "../plugins/entitlement";
import { resetVoteBudget } from "../plugins/routes";
import { runPluginMigrations } from "../plugins/runner";
import { updateSettings } from "../services/settings.service";
import { resetEnvCache } from "../utils/env";
import { setAddressResolver } from "../utils/ssrf-protection";

const TEST_DB = "./data/test-plugin-catalog-routes.db";

let app: Hono;
let token: string;

const realFetch = globalThis.fetch;

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "admin-password-1";
  process.env.JWT_SECRET = "test-secret-that-is-at-least-32-chars";
  resetEnvCache();
  // See plugin-catalog-service.test.ts: the catalog fetch resolves the host
  // before opening a socket, so a stubbed fetch alone is not enough.
  setAddressResolver(async () => ["93.184.216.34"]);

  initDatabase();
  runMigrations();
  await seed();
  runPluginMigrations();
  app = createApp();

  const res = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin-password-1" }),
  });
  const body = (await res.json()) as { data: { token: string } };
  token = body.data.token;
});

afterAll(() => {
  setAddressResolver(null);
  closeDatabase();
  // SQLite leaves -wal and -shm alongside the db; the existing suites clean all
  // three, and leaving them behind makes a later run start from stale state.
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {
      // best effort
    }
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setPluginEntitlementCheck(null);
});

// Evaluated per call: `token` is only assigned in beforeAll, and a module-level
// const would capture "undefined" before that.
function auth(): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

describe("GET /api/v1/plugins/catalog", () => {
  test("returns the merged payload with provenance", async () => {
    updateSettings({ plugin_catalog_url: "" }); // snapshot only, no egress
    const res = await app.request("/api/v1/plugins/catalog", { headers: auth() });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      data: {
        plugins: { id: string; installed: boolean; blockedReason: string | null }[];
        catalog: { source: string; syncedAt: string | null; error: string | null };
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.catalog.source).toBe("snapshot");

    const tt = body.data.plugins.find((p) => p.id === "time-tracker");
    expect(tt).toBeDefined();
    expect(tt!.installed).toBe(true);
    expect(tt!.blockedReason).toBeNull();
  });

  // Composition-proof: the id below is registered by nothing, in OSS or in any
  // overlay, so this asserts the route's cloud_only branch without depending on
  // which plugins the running build happens to ship. The previous version read
  // the snapshot's real cloud-only entry and had to disable itself whenever an
  // overlay registered it, which meant the assertion silently stopped running
  // in exactly the build most likely to break it.
  test("shows a cloud-only plugin this build does not ship as blocked", async () => {
    updateSettings({ plugin_catalog_url: "https://example.test/catalog.v1.json" });
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            schema: 1,
            plugins: [
              {
                id: "hosted-only-fixture",
                name: "Hosted Only",
                tagline: "",
                description: "",
                category: "billing",
                status: "available",
                availability: "cloud",
                requires_feature: null,
                icon: "Clock",
                docs: "https://example.com",
                source: null,
                screenshots: [],
                latest: { version: "1.0.0", min_app: "0.1.0", released: "2026-01-01" },
                versions: [],
              },
            ],
          }),
          { status: 200 },
        ),
      )) as unknown as typeof fetch;

    const res = await app.request("/api/v1/plugins/catalog", { headers: auth() });
    const body = (await res.json()) as {
      data: { plugins: { id: string; blockedReason: string | null }[] };
    };
    const hosted = body.data.plugins.find((p) => p.id === "hosted-only-fixture");
    expect(hosted).toBeDefined();
    expect(hosted!.blockedReason).toBe("cloud_only");
  });

  test("requires authentication", async () => {
    const res = await app.request("/api/v1/plugins/catalog");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/plugins/catalog/refresh", () => {
  test("forces a re-sync for an admin", async () => {
    updateSettings({ plugin_catalog_url: "https://example.test/catalog.v1.json" });
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ schema: 1, plugins: [] }), { status: 200 }),
      );
    }) as unknown as typeof fetch;

    const res = await app.request("/api/v1/plugins/catalog/refresh", {
      method: "POST",
      headers: auth(),
    });
    expect(res.status).toBe(200);
    expect(calls).toBeGreaterThan(0);
  });

  test("rejects an unauthenticated caller", async () => {
    const res = await app.request("/api/v1/plugins/catalog/refresh", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/plugins/catalog/vote", () => {
  test("forwards the id and returns the new count", async () => {
    updateSettings({ plugin_catalog_url: "https://example.test/catalog.v1.json" });
    const calls: string[] = [];
    globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push((init?.body as string) ?? "");
      return Promise.resolve(
        new Response(JSON.stringify({ count: 9, voted: true }), { status: 200 }),
      );
    }) as typeof fetch;

    const res = await app.request("/api/v1/plugins/catalog/vote", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: "accounts-payable" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { count: number | null } };
    expect(json.data.count).toBe(9);
    expect(calls[0]).toContain("accounts-payable");
  });

  test("sends a per-user vote identity, not the request address", async () => {
    updateSettings({ plugin_catalog_url: "https://example.test/catalog.v1.json" });
    let sentKey: string | null = null;
    globalThis.fetch = ((_url: RequestInfo | URL, init?: RequestInit) => {
      sentKey = new Headers(init?.headers).get("x-inkvoice-vote-key");
      return Promise.resolve(
        new Response(JSON.stringify({ count: 1, voted: true, alreadyVoted: false }), {
          status: 200,
        }),
      );
    }) as typeof fetch;

    resetVoteBudget();
    const res = await app.request("/api/v1/plugins/catalog/vote", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: "accounts-payable" }),
    });
    expect(res.status).toBe(200);
    expect(sentKey).toMatch(/^[a-f0-9]{32}$/);
  });

  test("budgets a single user's votes so one account cannot drive unbounded egress", async () => {
    updateSettings({ plugin_catalog_url: "https://example.test/catalog.v1.json" });
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ count: 1, voted: true, alreadyVoted: true }), {
          status: 200,
        }),
      )) as unknown as typeof fetch;

    resetVoteBudget();
    const send = () =>
      app.request("/api/v1/plugins/catalog/vote", {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ id: "accounts-payable" }),
      });

    let last = await send();
    for (let i = 0; i < 12 && last.status === 200; i++) last = await send();
    expect(last.status).toBe(429);
    resetVoteBudget();
  });

  test("is a no-op with egress off, and opens no socket", async () => {
    updateSettings({ plugin_catalog_url: "" });
    globalThis.fetch = (() => {
      throw new Error("must not fetch with egress off");
    }) as unknown as typeof fetch;

    const res = await app.request("/api/v1/plugins/catalog/vote", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: "accounts-payable" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { count: number | null } };
    expect(json.data.count).toBeNull();
  });

  test("rejects a malformed body", async () => {
    const res = await app.request("/api/v1/plugins/catalog/vote", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("rejects an unauthenticated caller", async () => {
    const res = await app.request("/api/v1/plugins/catalog/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "accounts-payable" }),
    });
    expect(res.status).toBe(401);
  });

  test("rejects an id longer than 64 characters", async () => {
    const res = await app.request("/api/v1/plugins/catalog/vote", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: "a".repeat(65) }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/plugins/catalog/refresh as a non-admin", () => {
  let userToken: string;

  beforeAll(async () => {
    const hash = await bcrypt.hash("catalog-user-pass", 10);
    getDb().run(
      "INSERT INTO users (id, username, password_hash, is_admin, is_active) VALUES (?, ?, ?, 0, 1)",
      [crypto.randomBytes(16).toString("hex"), "catalog_regular", hash],
    );
    const res = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "catalog_regular", password: "catalog-user-pass" }),
    });
    userToken = ((await res.json()) as { data: { token: string } }).data.token;
  });

  test("gets 403", async () => {
    updateSettings({ plugin_catalog_url: "https://example.test/catalog.v1.json" });
    const res = await app.request("/api/v1/plugins/catalog/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });
});
