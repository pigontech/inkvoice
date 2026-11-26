import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { getAllSettings, stripInternalSettings } from "../services/settings.service";
import {
  getUpdateCheck,
  LATEST_RELEASE_PAGE_URL,
  parseReleaseTag,
  setLatestReleaseFetcher,
  UPDATE_CHECK_CACHE_KEY,
  UPDATE_CHECK_RETRY_MS,
  UPDATE_CHECK_TTL_MS,
} from "../services/update-check.service";
import { resetEnvCache } from "../utils/env";
import { APP_VERSION } from "../utils/version";

const TEST_DB = "./data/test-update-check.db";

let app: Hono;
let token: string;

/** A release one minor version above the running build. */
const NEWER = (() => {
  const [major, minor] = APP_VERSION.split(".").map(Number);
  return `${major}.${minor + 1}.0`;
})();

function clearCache(): void {
  getDb().query("DELETE FROM settings WHERE key = ?").run(UPDATE_CHECK_CACHE_KEY);
}

/** Rewrite the cached lookup time so it looks `ageMs` old. */
function ageCache(ageMs: number): void {
  const row = getDb()
    .query("SELECT value FROM settings WHERE key = ?")
    .get(UPDATE_CHECK_CACHE_KEY) as { value: string };
  const cache = JSON.parse(row.value);
  cache.checkedAt = new Date(Date.now() - ageMs).toISOString();
  getDb()
    .query("UPDATE settings SET value = ? WHERE key = ?")
    .run(JSON.stringify(cache), UPDATE_CHECK_CACHE_KEY);
}

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "admin-password-1";
  process.env.JWT_SECRET = "test-secret-that-is-at-least-32-chars";
  process.env.RATE_LIMIT_ENABLED = "false";
  delete process.env.UPDATE_CHECK;
  resetEnvCache();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {
      // no stale file
    }
  }

  initDatabase();
  runMigrations();
  await seed();
  app = createApp();

  const res = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin-password-1" }),
  });
  token = ((await res.json()) as { data: { token: string } }).data.token;
});

afterEach(() => {
  setLatestReleaseFetcher(null);
  delete process.env.UPDATE_CHECK;
  resetEnvCache();
  clearCache();
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {
      // best effort
    }
  }
});

describe("parseReleaseTag", () => {
  test("accepts plain and v-prefixed stable versions", () => {
    expect(parseReleaseTag("v1.2.3")).toBe("1.2.3");
    expect(parseReleaseTag("1.2.3")).toBe("1.2.3");
  });

  test("rejects prereleases and junk", () => {
    expect(parseReleaseTag("v1.2.3-rc.1")).toBeNull();
    expect(parseReleaseTag("latest")).toBeNull();
    expect(parseReleaseTag(undefined)).toBeNull();
    expect(parseReleaseTag(123)).toBeNull();
  });
});

describe("getUpdateCheck", () => {
  test("reports an update when the latest release is newer", async () => {
    setLatestReleaseFetcher(async () => NEWER);
    const result = await getUpdateCheck();
    expect(result).toMatchObject({
      enabled: true,
      current: APP_VERSION,
      latest: NEWER,
      update_available: true,
      release_url: LATEST_RELEASE_PAGE_URL,
    });
    expect(result.checked_at).not.toBeNull();
  });

  test("is up to date when the latest release equals the running version", async () => {
    setLatestReleaseFetcher(async () => APP_VERSION);
    const result = await getUpdateCheck();
    expect(result.latest).toBe(APP_VERSION);
    expect(result.update_available).toBe(false);
  });

  test("a build newer than the latest release counts as up to date", async () => {
    setLatestReleaseFetcher(async () => "0.0.1");
    const result = await getUpdateCheck();
    expect(result.latest).toBe("0.0.1");
    expect(result.update_available).toBe(false);
  });

  test("answers from the cache until the TTL passes", async () => {
    let calls = 0;
    setLatestReleaseFetcher(async () => {
      calls++;
      return NEWER;
    });
    await getUpdateCheck();
    await getUpdateCheck();
    expect(calls).toBe(1);

    ageCache(UPDATE_CHECK_TTL_MS + 1000);
    await getUpdateCheck();
    expect(calls).toBe(2);
  });

  test("a failed lookup answers unknown and is retried after the shorter back-off", async () => {
    let calls = 0;
    setLatestReleaseFetcher(async () => {
      calls++;
      throw new Error("offline");
    });
    const first = await getUpdateCheck();
    expect(first).toMatchObject({ enabled: true, latest: null, update_available: false });

    // Still inside the back-off: no second request.
    await getUpdateCheck();
    expect(calls).toBe(1);

    ageCache(UPDATE_CHECK_RETRY_MS + 1000);
    await getUpdateCheck();
    expect(calls).toBe(2);
  });

  test("a failed refresh keeps the release it already knew about", async () => {
    setLatestReleaseFetcher(async () => NEWER);
    await getUpdateCheck();
    ageCache(UPDATE_CHECK_TTL_MS + 1000);

    setLatestReleaseFetcher(async () => null);
    const result = await getUpdateCheck();
    expect(result.latest).toBe(NEWER);
    expect(result.update_available).toBe(true);
  });

  test("UPDATE_CHECK=false makes no request and stores nothing", async () => {
    process.env.UPDATE_CHECK = "false";
    resetEnvCache();
    let calls = 0;
    setLatestReleaseFetcher(async () => {
      calls++;
      return NEWER;
    });
    const result = await getUpdateCheck();
    expect(result).toMatchObject({
      enabled: false,
      current: APP_VERSION,
      latest: null,
      update_available: false,
      checked_at: null,
    });
    expect(calls).toBe(0);
    expect(getAllSettings()[UPDATE_CHECK_CACHE_KEY]).toBeUndefined();
  });

  test("the cache never reaches the settings payload", async () => {
    setLatestReleaseFetcher(async () => NEWER);
    await getUpdateCheck();
    expect(getAllSettings()[UPDATE_CHECK_CACHE_KEY]).toBeDefined();
    expect(stripInternalSettings(getAllSettings())[UPDATE_CHECK_CACHE_KEY]).toBeUndefined();
  });
});

describe("GET /api/v1/settings/update-check", () => {
  test("returns the result to an admin", async () => {
    setLatestReleaseFetcher(async () => NEWER);
    const res = await app.request("/api/v1/settings/update-check", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ latest: NEWER, update_available: true });
  });

  test("rejects an unauthenticated request", async () => {
    const res = await app.request("/api/v1/settings/update-check");
    expect(res.status).toBe(401);
  });

  test("rejects a signed-in user who is not an admin", async () => {
    const create = await app.request("/api/v1/users", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "viewer-update-check",
        password: "viewer-password-1",
        display_name: "Viewer",
        role: "Viewer",
      }),
    });
    expect(create.status).toBeLessThan(300);
    const login = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "viewer-update-check", password: "viewer-password-1" }),
    });
    const viewerToken = ((await login.json()) as { data: { token: string } }).data.token;
    const res = await app.request("/api/v1/settings/update-check", {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    expect(res.status).toBe(403);
  });
});
