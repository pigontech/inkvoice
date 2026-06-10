import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { search } from "../services/search.service";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-search.db";
let app: Hono;
let adminToken: string;

async function login(username: string, password: string): Promise<string> {
  const res = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return ((await res.json()) as { data: { token: string } }).data.token;
}

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "searchtestpass";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  process.env.RATE_LIMIT_ENABLED = "false";
  resetEnvCache();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
  initDatabase();
  runMigrations();
  await seed();
  app = createApp();
  adminToken = await login("admin", "searchtestpass");

  const db = getDb();
  // Insert searchable rows
  db.run(
    "INSERT INTO customers (id, name, email, notes) VALUES ('cust-acme', 'Acme Corporation', 'billing@acme.test', 'Long-time client, prefers Net 30 terms')",
  );
  db.run(
    "INSERT INTO customers (id, name, email, notes) VALUES ('cust-globex', 'Globex Industries', 'orders@globex.test', 'Demanding quality control standards')",
  );
  db.run(
    "INSERT INTO products (id, name, description, sku, unit_price) VALUES ('prod-widget', 'Premium Widget', 'High-precision steel widget for industrial applications', 'W-100', 49.99)",
  );
  db.run(
    "INSERT INTO products (id, name, description, sku, unit_price) VALUES ('prod-gadget', 'Smart Gadget', 'IoT-enabled monitoring device', 'G-200', 199.0)",
  );
  db.run(
    "INSERT INTO invoices (id, invoice_number, customer_id, status, issue_date, notes) VALUES ('inv-1', 'INV-2026-0001', 'cust-acme', 'sent', '2026-01-15', 'Quarterly subscription renewal')",
  );
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

describe("search service", () => {
  test("finds customers by name", () => {
    const hits = search("Acme");
    expect(hits.length).toBeGreaterThan(0);
    const customerHit = hits.find((h) => h.kind === "customer");
    expect(customerHit?.title).toBe("Acme Corporation");
  });

  test("finds customers by free-text notes", () => {
    const hits = search("Net 30");
    expect(hits.some((h) => h.kind === "customer" && h.id === "cust-acme")).toBe(true);
  });

  test("finds products by description", () => {
    const hits = search("monitoring");
    expect(hits.some((h) => h.kind === "product" && h.id === "prod-gadget")).toBe(true);
  });

  test("finds invoices by note text", () => {
    const hits = search("subscription");
    expect(hits.some((h) => h.kind === "invoice" && h.id === "inv-1")).toBe(true);
  });

  test("supports prefix matching", () => {
    const hits = search("indust"); // should match "Industries" and "industrial"
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  test("filters by kind", () => {
    const allHits = search("steel");
    expect(allHits.some((h) => h.kind === "product")).toBe(true);

    const justCustomers = search("steel", { kind: "customer" });
    expect(justCustomers.length).toBe(0);
  });

  test("returns empty array for empty query", () => {
    expect(search("")).toEqual([]);
    expect(search("   ")).toEqual([]);
  });

  test("snippet wraps matches in <mark> tags", () => {
    const hits = search("monitoring");
    expect(hits[0]?.snippet).toContain("<mark>");
    expect(hits[0]?.snippet).toContain("</mark>");
  });
});

describe("GET /search", () => {
  test("returns hits over HTTP", async () => {
    const res = await app.request("/api/v1/search?q=Acme", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { hits: { title: string; kind: string }[] } };
    expect(body.data.hits.length).toBeGreaterThan(0);
    expect(body.data.hits.some((h) => h.title === "Acme Corporation")).toBe(true);
  });

  test("respects kind filter", async () => {
    const res = await app.request("/api/v1/search?q=Acme&kind=customer", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = (await res.json()) as { data: { hits: { kind: string }[] } };
    expect(body.data.hits.every((h) => h.kind === "customer")).toBe(true);
  });

  test("requires auth", async () => {
    const res = await app.request("/api/v1/search?q=Acme");
    expect(res.status).toBe(401);
  });
});

describe("FTS sync triggers", () => {
  test("inserting a new customer makes it searchable", () => {
    const db = getDb();
    db.run(
      "INSERT INTO customers (id, name, email, notes) VALUES ('cust-new', 'Fizzbuzz LLC', 'hi@fizzbuzz.test', 'Specializes in obscure widgets')",
    );
    const hits = search("Fizzbuzz");
    expect(hits.some((h) => h.id === "cust-new")).toBe(true);
  });

  test("updating a customer reflects in search", () => {
    const db = getDb();
    db.run("UPDATE customers SET notes = 'Now prefers ZipZap delivery' WHERE id = 'cust-globex'");
    const hits = search("ZipZap");
    expect(hits.some((h) => h.id === "cust-globex")).toBe(true);
  });

  test("deleting a customer removes it from search", () => {
    const db = getDb();
    db.run(
      "INSERT INTO customers (id, name, notes) VALUES ('cust-temp', 'Temporary Co', 'foobarbaz unique tag')",
    );
    expect(search("foobarbaz").length).toBeGreaterThan(0);
    db.run("DELETE FROM customers WHERE id = 'cust-temp'");
    expect(search("foobarbaz").length).toBe(0);
  });
});
