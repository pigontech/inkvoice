// Every route that reads or changes the books checks the caller's role. A
// route without a guard is open to any signed-in user, including the
// read-only Viewer that SSO provisions on first login. So the first tests walk
// every registered route rather than a hand-picked list: a route added
// without requirePermission fails them.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { hasPermission } from "../middleware/auth";
import { createToken } from "../services/api-token.service";
import { resetEnvCache } from "../utils/env";
import { signToken } from "../utils/jwt";
import { hashPassword } from "../utils/password";
import { ALL_ACTIONS, RESOURCES } from "../utils/permissions";

const TEST_DB = "./data/test-route-permissions.db";

/** Routers whose every route carries requirePermission. */
const GUARDED_PREFIXES = [
  "/api/v1/invoices",
  "/api/v1/quotes",
  "/api/v1/recurring-invoices",
  "/api/v1/customers",
  "/api/v1/products",
  "/api/v1/expenses",
  "/api/v1/tax-definitions",
  "/api/v1/templates",
  "/api/v1/reminder-rules",
];

/** POSTs that only render a preview, so they need nothing beyond read. */
const READ_ONLY_POSTS = new Set([
  "POST /api/v1/templates/preview",
  "POST /api/v1/templates/unknown-id/preview",
]);

let app: Hono;
const token = { admin: "", accountant: "", viewer: "", nobody: "", legacy: "" };

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "routepermissionspass";
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

  const db = getDb();
  const addUser = (id: string, role: string | null) =>
    db.run(
      "INSERT INTO users (id, username, email, password_hash, is_admin, is_active, role) VALUES (?, ?, ?, 'x', 0, 1, ?)",
      [id, id, `${id}@example.com`, role],
    );
  addUser("accountant-1", "Accountant");
  addUser("viewer-1", "Viewer");
  // No role and no legacy grants: allowed nothing at all.
  addUser("nobody-1", null);
  // A Viewer from before roles, with a legacy grant to update invoices only.
  addUser("legacy-1", "Viewer");
  db.run(
    "INSERT INTO user_permissions (id, user_id, resource, action) VALUES ('perm-1', 'legacy-1', 'invoices', 'update')",
  );

  const admin = db.query("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
  token.admin = await signToken({ sub: admin.id, username: "admin", is_admin: true });
  for (const id of ["accountant", "viewer", "nobody", "legacy"] as const) {
    token[id] = await signToken({ sub: `${id}-1`, username: `${id}-1`, is_admin: false });
  }
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(TEST_DB + suffix);
    } catch {}
  }
});

function call(bearer: string, method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Every method + path registered under the guarded routers, params filled in. */
function guardedRoutes(): { method: string; path: string }[] {
  const seen = new Set<string>();
  const routes: { method: string; path: string }[] = [];
  for (const r of app.routes) {
    if (r.method === "ALL") continue; // middleware
    if (!GUARDED_PREFIXES.some((p) => r.path === p || r.path.startsWith(`${p}/`))) continue;
    const path = r.path.replace(/:[A-Za-z]+/g, "unknown-id");
    const key = `${r.method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ method: r.method, path });
  }
  return routes;
}

async function statusOf(bearer: string, route: { method: string; path: string }) {
  const body = route.method === "GET" ? undefined : {};
  return (await call(bearer, route.method, route.path, body)).status;
}

describe("every guarded route", () => {
  test("refuses a user who holds no permission", async () => {
    const routes = guardedRoutes();
    // Guards against the walk silently finding nothing.
    expect(routes.length).toBeGreaterThan(120);

    const open: string[] = [];
    for (const route of routes) {
      if ((await statusOf(token.nobody, route)) !== 403) open.push(`${route.method} ${route.path}`);
    }
    expect(open).toEqual([]);
  });

  test("lets a Viewer read and refuses every change", async () => {
    const wrong: string[] = [];
    for (const route of guardedRoutes()) {
      const key = `${route.method} ${route.path}`;
      const isRead = route.method === "GET" || READ_ONLY_POSTS.has(key);
      const status = await statusOf(token.viewer, route);
      if (isRead === (status === 403)) wrong.push(`${key} -> ${status}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("a Viewer cannot alter money records", () => {
  test("mark paid, void, delete, payments, credit notes and customers all refuse", async () => {
    // Each target is in the state its action needs, so a missing guard would
    // let the action through rather than fail on the invoice's status.
    const post = async (path: string, body: unknown) =>
      ((await (await call(token.admin, "POST", path, body)).json()) as { data: { id: string } })
        .data.id;
    const customer = await post("/api/v1/customers", { name: "Acme" });
    const spareCustomer = await post("/api/v1/customers", { name: "No invoices yet" });
    const newInvoice = () =>
      post("/api/v1/invoices", {
        customer_id: customer,
        issue_date: "2026-10-01",
        items: [{ description: "Work", quantity: 1, unit_price: 500 }],
      });
    const draft = await newInvoice();
    const sent = await newInvoice();
    expect((await call(token.admin, "POST", `/api/v1/invoices/${sent}/mark-sent`)).status).toBe(
      200,
    );

    const attempts: [string, string, unknown?][] = [
      ["POST", `/api/v1/invoices/${sent}/mark-paid`],
      ["POST", `/api/v1/invoices/${sent}/void`],
      ["POST", `/api/v1/invoices/${sent}/payments`, { amount: 500, payment_date: "2026-10-02" }],
      ["POST", `/api/v1/invoices/${sent}/credit-note`],
      ["POST", "/api/v1/invoices/batch", { ids: [sent], action: "mark-paid" }],
      ["DELETE", `/api/v1/invoices/${draft}`],
      ["DELETE", `/api/v1/customers/${spareCustomer}`],
    ];
    for (const [method, path, body] of attempts) {
      const res = await call(token.viewer, method, path, body);
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 403 });
    }

    const db = getDb();
    const invoiceState = (id: string) =>
      db.query("SELECT status, deleted_at FROM invoices WHERE id = ?").get(id);
    expect(invoiceState(sent)).toEqual({ status: "sent", deleted_at: null });
    expect(invoiceState(draft)).toEqual({ status: "draft", deleted_at: null });
    expect(db.query("SELECT COUNT(*) AS n FROM payments").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 2 });
    expect(db.query("SELECT id FROM customers WHERE id = ?").get(spareCustomer)).not.toBeNull();
  });

  test("an API token acts with its owner's role, not more", async () => {
    const { token: apiToken } = createToken("viewer-1", "integration", []);
    const res = await call(apiToken, "POST", "/api/v1/customers", { name: "Via token" });
    expect(res.status).toBe(403);
  });
});

describe("roles that may write", () => {
  test("an Accountant runs the books but leaves templates, tax rates and reminders alone", async () => {
    const customer = await call(token.accountant, "POST", "/api/v1/customers", { name: "Globex" });
    expect(customer.status).toBe(201);
    const { data } = (await customer.json()) as { data: { id: string } };

    const invoice = await call(token.accountant, "POST", "/api/v1/invoices", {
      customer_id: data.id,
      issue_date: "2026-10-01",
      items: [{ description: "Consulting", quantity: 2, unit_price: 100 }],
    });
    expect(invoice.status).toBe(201);
    const { data: inv } = (await invoice.json()) as { data: { id: string } };
    for (const step of ["mark-sent", "publish", "mark-paid"]) {
      const res = await call(token.accountant, "POST", `/api/v1/invoices/${inv.id}/${step}`);
      expect({ step, status: res.status }).toEqual({ step, status: 200 });
    }

    const expense = await call(token.accountant, "POST", "/api/v1/expenses", {
      expense_date: "2026-10-01",
      amount: 42,
    });
    expect(expense.status).toBe(201);

    expect((await call(token.accountant, "GET", "/api/v1/templates")).status).toBe(200);
    const refused = [
      await call(token.accountant, "POST", "/api/v1/templates", {
        name: "Mine",
        html_content: "<p></p>",
      }),
      await call(token.accountant, "POST", "/api/v1/tax-definitions", { name: "VAT", rate: 20 }),
      await call(token.accountant, "POST", "/api/v1/reminder-rules", {
        name: "Nudge",
        days_offset: 3,
        type: "after_due",
        email_subject: "Reminder",
        email_body: "Please pay",
      }),
    ];
    expect(refused.map((r) => r.status)).toEqual([403, 403, 403]);
  });

  test("a batch action needs what its single-invoice route needs", async () => {
    // legacy-1 may update invoices but not delete them.
    const customer = (await (
      await call(token.admin, "POST", "/api/v1/customers", { name: "Initech" })
    ).json()) as { data: { id: string } };
    const invoice = (await (
      await call(token.admin, "POST", "/api/v1/invoices", {
        customer_id: customer.data.id,
        issue_date: "2026-10-01",
        items: [{ description: "Work", quantity: 1, unit_price: 10 }],
      })
    ).json()) as { data: { id: string } };
    const ids = [invoice.data.id];

    const markSent = await call(token.legacy, "POST", "/api/v1/invoices/batch", {
      ids,
      action: "mark-sent",
    });
    expect(markSent.status).toBe(200);
    const remove = await call(token.legacy, "POST", "/api/v1/invoices/batch", {
      ids,
      action: "delete",
    });
    expect(remove.status).toBe(403);
    expect(getDb().query("SELECT deleted_at FROM invoices WHERE id = ?").get(ids[0])).toEqual({
      deleted_at: null,
    });
  });
});

// The app hides what a user may not do from `access`, so it must say exactly
// what the guards above enforce, no more and no less.
describe("the access map the app is given", () => {
  test("matches requirePermission for every role, resource and action", async () => {
    const users = [
      { id: "accountant-1", bearer: token.accountant },
      { id: "viewer-1", bearer: token.viewer },
      { id: "nobody-1", bearer: token.nobody },
      { id: "legacy-1", bearer: token.legacy },
    ];
    for (const user of users) {
      const me = (await (await call(user.bearer, "GET", "/api/v1/auth/me")).json()) as {
        data: { access: Record<string, string[]> };
      };
      for (const resource of RESOURCES) {
        for (const action of ALL_ACTIONS) {
          const enforced = hasPermission(
            { sub: user.id, username: user.id, is_admin: false, v: 1, exp: 0 },
            resource,
            action,
          );
          expect({
            user: user.id,
            resource,
            action,
            allowed: me.data.access[resource].includes(action),
          }).toEqual({ user: user.id, resource, action, allowed: enforced });
        }
      }
    }
  });

  test("a Viewer is told it may only read, from the moment it signs in", async () => {
    getDb().run(
      "INSERT INTO users (id, username, password_hash, is_admin, is_active, role) VALUES ('viewer-2', 'viewer-2', ?, 0, 1, 'Viewer')",
      [await hashPassword("viewer-two-password")],
    );
    const res = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "viewer-2", password: "viewer-two-password" }),
    });
    const { data } = (await res.json()) as { data: { user: { access: Record<string, string[]> } } };
    expect(data.user.access.invoices).toEqual(["read", "export"]);
    expect(data.user.access.templates).toEqual(["read"]);
    expect(data.user.access.users).toEqual([]);
  });

  test("an admin may do everything", async () => {
    const me = (await (await call(token.admin, "GET", "/api/v1/auth/me")).json()) as {
      data: { access: Record<string, string[]> };
    };
    for (const resource of RESOURCES) expect(me.data.access[resource]).toEqual(ALL_ACTIONS);
  });
});
