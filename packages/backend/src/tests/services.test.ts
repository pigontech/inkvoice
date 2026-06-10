import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-services.db";
let app: Hono;
let token: string;

async function authed(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    ...((opts.headers as Record<string, string>) || {}),
    Authorization: `Bearer ${token}`,
  };
  if (!(opts.body instanceof FormData) && opts.method && opts.method !== "GET") {
    headers["Content-Type"] = "application/json";
  }
  return app.request(new Request(`http://localhost${path}`, { ...opts, headers }));
}

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "testpass123456";
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
    body: JSON.stringify({ username: "admin", password: "testpass123456" }),
  });
  const data = (await res.json()) as any;
  token = data.data.token;
});

afterAll(() => {
  closeDatabase();
  try {
    unlinkSync(TEST_DB);
  } catch {}
  try {
    unlinkSync(`${TEST_DB}-wal`);
  } catch {}
  try {
    unlinkSync(`${TEST_DB}-shm`);
  } catch {}
});

describe("Products CRUD", () => {
  let productId: string;

  test("create product", async () => {
    const res = await authed("/api/v1/products", {
      method: "POST",
      body: JSON.stringify({ name: "Test Service", unit_price: 99.99, category: "service" }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.data.name).toBe("Test Service");
    productId = data.data.id;
  });

  test("list products", async () => {
    const res = await authed("/api/v1/products");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.items.length).toBeGreaterThan(0);
  });

  test("update product", async () => {
    const res = await authed(`/api/v1/products/${productId}`, {
      method: "PUT",
      body: JSON.stringify({ name: "Updated Service", unit_price: 149.99 }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.name).toBe("Updated Service");
  });

  test("delete product", async () => {
    const res = await authed(`/api/v1/products/${productId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
  });
});

describe("Tax Definitions CRUD", () => {
  let taxId: string;

  test("create tax definition", async () => {
    const res = await authed("/api/v1/tax-definitions", {
      method: "POST",
      body: JSON.stringify({ name: "VAT 20%", rate: 20, description: "Standard VAT" }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.data.rate).toBe(20);
    taxId = data.data.id;
  });

  test("list tax definitions", async () => {
    const res = await authed("/api/v1/tax-definitions");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.length).toBeGreaterThanOrEqual(2); // default + new
  });

  test("update tax definition", async () => {
    const res = await authed(`/api/v1/tax-definitions/${taxId}`, {
      method: "PUT",
      body: JSON.stringify({ name: "VAT 21%", rate: 21 }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.rate).toBe(21);
  });

  test("delete tax definition", async () => {
    const res = await authed(`/api/v1/tax-definitions/${taxId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
  });
});

describe("Templates CRUD", () => {
  let templateId: string;

  test("create template", async () => {
    const res = await authed("/api/v1/templates", {
      method: "POST",
      body: JSON.stringify({ name: "Test Template", html_content: "<h1>{{invoice_number}}</h1>" }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.data.name).toBe("Test Template");
    templateId = data.data.id;
  });

  test("list templates", async () => {
    const res = await authed("/api/v1/templates");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.length).toBeGreaterThanOrEqual(2);
  });

  test("update template", async () => {
    const res = await authed(`/api/v1/templates/${templateId}`, {
      method: "PUT",
      body: JSON.stringify({
        name: "Updated Template",
        html_content: "<h1>Updated {{invoice_number}}</h1>",
      }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.name).toBe("Updated Template");
  });

  test("delete template", async () => {
    const res = await authed(`/api/v1/templates/${templateId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
  });
});

describe("Users CRUD", () => {
  let userId: string;

  test("create user", async () => {
    const res = await authed("/api/v1/users", {
      method: "POST",
      body: JSON.stringify({
        username: "testuser",
        password: "testpassword12",
        email: "test@example.com",
      }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.data.username).toBe("testuser");
    userId = data.data.id;
  });

  test("list users", async () => {
    const res = await authed("/api/v1/users");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.length).toBeGreaterThanOrEqual(2);
  });

  test("update user", async () => {
    const res = await authed(`/api/v1/users/${userId}`, {
      method: "PUT",
      body: JSON.stringify({ display_name: "Test User" }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.display_name).toBe("Test User");
  });

  test("delete user", async () => {
    const res = await authed(`/api/v1/users/${userId}`, { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  test("password too short returns 400", async () => {
    const res = await authed("/api/v1/users", {
      method: "POST",
      body: JSON.stringify({ username: "shortpw", password: "abc" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Invoice State Machine", () => {
  let customerId: string;
  let invoiceId: string;

  test("setup: create customer", async () => {
    const res = await authed("/api/v1/customers", {
      method: "POST",
      body: JSON.stringify({ name: "State Test Corp" }),
    });
    customerId = ((await res.json()) as any).data.id;
  });

  test("setup: create invoice", async () => {
    const res = await authed("/api/v1/invoices", {
      method: "POST",
      body: JSON.stringify({
        customer_id: customerId,
        issue_date: "2026-04-01",
        items: [{ description: "Item", quantity: 1, unit_price: 100 }],
      }),
    });
    invoiceId = ((await res.json()) as any).data.id;
  });

  test("cannot mark draft as paid", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}/mark-paid`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("cannot void a draft", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}/void`, { method: "POST" });
    expect(res.status).toBe(400);
  });

  test("can mark draft as sent", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}/mark-sent`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.status).toBe("sent");
  });

  test("cannot edit sent invoice", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}`, {
      method: "PUT",
      body: JSON.stringify({
        customer_id: customerId,
        issue_date: "2026-04-01",
        items: [{ description: "Changed", quantity: 1, unit_price: 200 }],
      }),
    });
    expect(res.status).toBe(404);
  });

  test("can mark sent as paid", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}/mark-paid`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.status).toBe("paid");
  });

  test("cannot mark paid as paid again", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}/mark-paid`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("Edge Cases", () => {
  test("malformed JSON returns 400", async () => {
    const res = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json{{{",
    });
    expect(res.status).toBe(400);
  });

  test("unicode in customer name", async () => {
    const res = await authed("/api/v1/customers", {
      method: "POST",
      body: JSON.stringify({ name: "Firma GmbH" }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.data.name).toBe("Firma GmbH");
  });

  test("invalid page param defaults to 1", async () => {
    const res = await authed("/api/v1/invoices?page=abc");
    expect(res.status).toBe(200);
  });

  test("negative page param defaults to 1", async () => {
    const res = await authed("/api/v1/invoices?page=-5");
    expect(res.status).toBe(200);
  });
});
