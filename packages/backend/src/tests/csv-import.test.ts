import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { parseCsv } from "../utils/csv-parser";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-csv-import.db";
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
  process.env.ADMIN_PASS = "csvtestpass";
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
  adminToken = await login("admin", "csvtestpass");
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

describe("parseCsv", () => {
  test("handles quoted fields with commas and escaped quotes", () => {
    const input = 'name,note\n"Smith, John","He said ""hi"""';
    const parsed = parseCsv(input);
    expect(parsed.headers).toEqual(["name", "note"]);
    expect(parsed.rows).toEqual([["Smith, John", 'He said "hi"']]);
  });

  test("handles CRLF line endings and BOM", () => {
    const input = "﻿a,b\r\n1,2\r\n3,4";
    const parsed = parseCsv(input);
    expect(parsed.headers).toEqual(["a", "b"]);
    expect(parsed.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  test("skips blank lines", () => {
    const input = "x\n\n1\n\n2\n";
    const parsed = parseCsv(input);
    expect(parsed.rows).toEqual([["1"], ["2"]]);
  });
});

describe("POST /customers/import/preview", () => {
  test("returns headers and suggested mapping", async () => {
    const csv = "Name,Email,VAT\nAcme Co,billing@acme.test,GB12345";
    const formData = new FormData();
    formData.append("csv", new Blob([csv], { type: "text/csv" }), "customers.csv");
    const res = await app.request("/api/v1/customers/import/preview", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: formData,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        headers: string[];
        suggested_mapping: Record<string, string>;
        total_rows: number;
      };
    };
    expect(body.data.headers).toEqual(["Name", "Email", "VAT"]);
    expect(body.data.suggested_mapping["0"]).toBe("name");
    expect(body.data.suggested_mapping["1"]).toBe("email");
    // VAT → tax_id alias
    expect(body.data.suggested_mapping["2"]).toBe("tax_id");
    expect(body.data.total_rows).toBe(1);
  });
});

describe("POST /customers/import (dry run)", () => {
  test("validates rows without inserting when dry_run=true", async () => {
    const before = (getDb().query("SELECT COUNT(*) as c FROM customers").get() as { c: number }).c;

    const csv = "name,email\nAlice,alice@example.com\nBob,not-an-email\n,missing";
    const res = await app.request("/api/v1/customers/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        csv,
        mapping: { "0": "name", "1": "email" },
        dry_run: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { dry_run: boolean; would_create: number; errors: { row: number }[] };
    };
    expect(body.data.dry_run).toBe(true);
    expect(body.data.would_create).toBe(1); // Alice
    expect(body.data.errors.length).toBe(2); // Bob (bad email) + missing name

    const after = (getDb().query("SELECT COUNT(*) as c FROM customers").get() as { c: number }).c;
    expect(after).toBe(before);
  });

  test("rejects mapping without name field", async () => {
    const csv = "email\nalice@example.com";
    const res = await app.request("/api/v1/customers/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        csv,
        mapping: { "0": "email" },
        dry_run: false,
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /customers/import (real insert)", () => {
  test("creates customers with the mapped fields", async () => {
    const before = (getDb().query("SELECT COUNT(*) as c FROM customers").get() as { c: number }).c;
    const csv = "name,email,city\nCharlie,charlie@example.com,Boston\nDana,dana@example.com,Berlin";
    const res = await app.request("/api/v1/customers/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        csv,
        mapping: { "0": "name", "1": "email", "2": "city" },
        dry_run: false,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { created: number; failed: number } };
    expect(body.data.created).toBe(2);

    const after = (getDb().query("SELECT COUNT(*) as c FROM customers").get() as { c: number }).c;
    expect(after).toBe(before + 2);

    const charlie = getDb()
      .query("SELECT name, email, city FROM customers WHERE name = 'Charlie'")
      .get() as { name: string; email: string; city: string };
    expect(charlie.email).toBe("charlie@example.com");
    expect(charlie.city).toBe("Boston");
  });
});

describe("POST /products/import", () => {
  test("auto-maps Price → unit_price and inserts on dry_run=false", async () => {
    const csv = "Title,Price,SKU\nWidget,19.99,W-1\nGadget,49.50,G-2";
    // First check the suggested mapping
    const formData = new FormData();
    formData.append("csv", new Blob([csv], { type: "text/csv" }), "products.csv");
    const previewRes = await app.request("/api/v1/products/import/preview", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: formData,
    });
    const preview = (await previewRes.json()) as {
      data: { suggested_mapping: Record<string, string> };
    };
    expect(preview.data.suggested_mapping["0"]).toBe("name"); // Title alias
    expect(preview.data.suggested_mapping["1"]).toBe("unit_price"); // Price alias
    expect(preview.data.suggested_mapping["2"]).toBe("sku");

    const before = (getDb().query("SELECT COUNT(*) as c FROM products").get() as { c: number }).c;
    const importRes = await app.request("/api/v1/products/import", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        csv,
        mapping: preview.data.suggested_mapping,
        dry_run: false,
      }),
    });
    expect(importRes.status).toBe(200);

    const after = (getDb().query("SELECT COUNT(*) as c FROM products").get() as { c: number }).c;
    expect(after).toBe(before + 2);

    const widget = getDb()
      .query("SELECT name, unit_price, sku FROM products WHERE name = 'Widget'")
      .get() as { name: string; unit_price: number; sku: string };
    expect(widget.unit_price).toBe(19.99);
    expect(widget.sku).toBe("W-1");
  });
});
