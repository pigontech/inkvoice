import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { createToken, hashToken, listTokens, revokeToken } from "../services/api-token.service";
import { createCustomer, listCustomers } from "../services/customer.service";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-api-tokens.db";
let app: Hono;
let sessionToken: string;
let adminId: string;

async function withBearer(path: string, bearer: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    ...((opts.headers as Record<string, string>) || {}),
    Authorization: `Bearer ${bearer}`,
  };
  if (!(opts.body instanceof FormData) && opts.method && opts.method !== "GET") {
    headers["Content-Type"] = "application/json";
  }
  return app.request(new Request(`http://localhost${path}`, { ...opts, headers }));
}

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "testpass123";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  process.env.RATE_LIMIT_ENABLED = "false";
  resetEnvCache();

  initDatabase();
  runMigrations();
  await seed();
  app = createApp();

  const res = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "testpass123" }),
  });
  sessionToken = ((await res.json()) as any).data.token;

  adminId = (
    getDb().query("SELECT id FROM users WHERE username = 'admin'").get() as {
      id: string;
    }
  ).id;
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
});

describe("api-token service", () => {
  test("createToken returns an ink_-prefixed plaintext and stores only its hash", () => {
    const { token, record } = createToken(adminId, "svc", ["invoices:read"]);
    expect(token.startsWith("ink_")).toBe(true);
    expect(record.token_prefix).toBe(token.slice(0, 12));
    expect(record.scopes).toEqual(["invoices:read"]);

    const stored = getDb()
      .query("SELECT token_hash FROM api_tokens WHERE id = ?")
      .get(record.id) as { token_hash: string };
    expect(stored.token_hash).toBe(hashToken(token));
    // The plaintext is never persisted.
    expect(stored.token_hash).not.toContain(token);
  });

  test("listTokens hides the hash and revokeToken hides the token", () => {
    const { record } = createToken(adminId, "to-revoke", []);
    expect(listTokens(adminId).some((t) => t.id === record.id)).toBe(true);
    expect(
      (listTokens(adminId)[0] as unknown as Record<string, unknown>).token_hash,
    ).toBeUndefined();

    expect(revokeToken(record.id, adminId)).toBe(true);
    expect(listTokens(adminId).some((t) => t.id === record.id)).toBe(false);
    // Revoking twice is a no-op.
    expect(revokeToken(record.id, adminId)).toBe(false);
  });
});

describe("api-token HTTP auth", () => {
  test("POST /api/v1/api-tokens (session) issues a usable bearer token", async () => {
    const res = await withBearer("/api/v1/api-tokens", sessionToken, {
      method: "POST",
      body: JSON.stringify({ name: "full-access" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.token.startsWith("ink_")).toBe(true);

    // The full-access token authenticates as the owner across resources.
    const inv = await withBearer("/api/v1/invoices", body.data.token);
    expect(inv.status).toBe(200);
    const cust = await withBearer("/api/v1/customers", body.data.token);
    expect(cust.status).toBe(200);
  });

  test("an unknown/garbage ink_ token is rejected", async () => {
    const res = await withBearer("/api/v1/invoices", "ink_not_a_real_token");
    expect(res.status).toBe(401);
  });

  test("a revoked token stops working", async () => {
    const create = await withBearer("/api/v1/api-tokens", sessionToken, {
      method: "POST",
      body: JSON.stringify({ name: "ephemeral" }),
    });
    const { token, id } = ((await create.json()) as any).data;
    expect((await withBearer("/api/v1/invoices", token)).status).toBe(200);

    const del = await withBearer(`/api/v1/api-tokens/${id}`, sessionToken, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await withBearer("/api/v1/invoices", token)).status).toBe(401);
  });
});

describe("api-token scope enforcement", () => {
  let readOnly: string;

  test("setup: create an invoices:read scoped token", async () => {
    const res = await withBearer("/api/v1/api-tokens", sessionToken, {
      method: "POST",
      body: JSON.stringify({ name: "zapier", scopes: ["invoices:read"] }),
    });
    readOnly = ((await res.json()) as any).data.token;
  });

  test("granted resource+action is allowed", async () => {
    expect((await withBearer("/api/v1/invoices", readOnly)).status).toBe(200);
  });

  test("write on a read-only scope is forbidden", async () => {
    const res = await withBearer("/api/v1/invoices", readOnly, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  test("an ungranted resource is forbidden", async () => {
    expect((await withBearer("/api/v1/customers", readOnly)).status).toBe(403);
  });

  test("a non-integration resource is forbidden for scoped tokens", async () => {
    expect((await withBearer("/api/v1/settings", readOnly)).status).toBe(403);
  });

  test("invalid scope strings are rejected at creation", async () => {
    const res = await withBearer("/api/v1/api-tokens", sessionToken, {
      method: "POST",
      body: JSON.stringify({ name: "bad", scopes: ["settings:read"] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("updated_since polling filter", () => {
  test("filters customers by updated_at", () => {
    const c = createCustomer({ name: "Polling Co", email: "p@example.com" });
    expect(c.id).toBeDefined();

    const future = listCustomers({ updated_since: "2999-01-01T00:00:00Z", page: 1, limit: 50 });
    expect(future.items.some((x) => x.id === c.id)).toBe(false);

    const past = listCustomers({ updated_since: "2000-01-01T00:00:00Z", page: 1, limit: 50 });
    expect(past.items.some((x) => x.id === c.id)).toBe(true);
  });
});
