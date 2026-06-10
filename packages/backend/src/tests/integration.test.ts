import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-integration.db";
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
  process.env.ADMIN_PASS = "testpass123";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  process.env.RATE_LIMIT_ENABLED = "false";
  resetEnvCache();

  initDatabase();
  runMigrations();
  await seed();
  app = createApp();

  // Login
  const res = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "testpass123" }),
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

describe("Full Invoice Workflow", () => {
  let customerId: string;
  let quoteCustomerId: string;
  let productId: string;
  let invoiceId: string;
  let shareToken: string;

  test("create customer", async () => {
    const res = await authed("/api/v1/customers", {
      method: "POST",
      body: JSON.stringify({ name: "Test Corp", email: "test@example.com", phone: "555-0100" }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    customerId = data.data.id;
  });

  test("create customer without email (for quote send without SMTP)", async () => {
    const res = await authed("/api/v1/customers", {
      method: "POST",
      body: JSON.stringify({ name: "Quote Client No Email", email: "" }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    quoteCustomerId = data.data.id;
  });

  test("create product", async () => {
    const res = await authed("/api/v1/products", {
      method: "POST",
      body: JSON.stringify({ name: "Web Design", unit_price: 1500, category: "service" }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    productId = data.data.id;
  });

  test("create invoice with items", async () => {
    const res = await authed("/api/v1/invoices", {
      method: "POST",
      body: JSON.stringify({
        customer_id: customerId,
        issue_date: "2026-04-01",
        due_date: "2026-05-01",
        payment_terms: "Net 30",
        items: [
          {
            product_id: productId,
            description: "Web Design",
            quantity: 1,
            unit_price: 1500,
            tax_rate: 10,
          },
          { description: "Hosting Setup", quantity: 1, unit_price: 200, tax_rate: 0 },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    invoiceId = data.data.id;
    expect(data.data.status).toBe("draft");
    expect(data.data.subtotal).toBe(1700);
    expect(data.data.tax_total).toBe(150);
    expect(data.data.total).toBe(1850);
    expect(data.data.items.length).toBe(2);
  });

  test("get invoice", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.customer.name).toBe("Test Corp");
  });

  test("mark invoice as sent", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}/mark-sent`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.status).toBe("sent");
  });

  test("publish invoice", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}/publish`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.status).toBe("sent");
    expect(data.data.share_token).toBeDefined();
    expect(data.data.is_published).toBe(1);
    shareToken = data.data.share_token;
  });

  test("view public invoice", async () => {
    const res = await app.request(`/api/v1/public/invoices/${shareToken}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.data.invoice.invoice_number).toBeDefined();
    expect(data.data.settings.company_name).toBeDefined();
  });

  test("unpublish invoice", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}/unpublish`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.is_published).toBe(0);
  });

  test("public invoice not accessible after unpublish", async () => {
    const res = await app.request(`/api/v1/public/invoices/${shareToken}`);
    expect(res.status).toBe(404);
  });

  test("re-publish reuses same share token", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}/publish`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.share_token).toBe(shareToken);
    expect(data.data.is_published).toBe(1);
  });

  test("mark as paid", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}/mark-paid`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.status).toBe("paid");
  });

  test("duplicate invoice", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}/duplicate`, { method: "POST" });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.data.status).toBe("draft");
    expect(data.data.items.length).toBe(2);
  });

  test("dashboard shows stats", async () => {
    const res = await authed("/api/v1/dashboard/stats");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.total_revenue).toBe(1850);
    expect(data.data.total_customers).toBe(2);
  });

  test("settings CRUD", async () => {
    const res = await authed("/api/v1/settings", {
      method: "PUT",
      body: JSON.stringify({ company_name: "Test Company" }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.company_name).toBe("Test Company");
  });

  test("cannot delete customer with invoices", async () => {
    const res = await authed(`/api/v1/customers/${customerId}`, { method: "DELETE" });
    expect(res.status).toBe(409);
  });

  test("export invoices CSV", async () => {
    const res = await authed("/api/v1/invoices/export/csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("invoices-");
    const text = await res.text();
    expect(text).toContain("Invoice Number");
    expect(text).toContain("Test Corp");
  });

  test("export invoices CSV respects status filter", async () => {
    const res = await authed("/api/v1/invoices/export/csv?status=draft");
    const text = await res.text();
    const lines = text.trim().split("\r\n");
    // Header + only draft invoices (the duplicated one)
    for (const line of lines.slice(1)) {
      expect(line).toContain("draft");
    }
  });

  test("export customers CSV", async () => {
    const res = await authed("/api/v1/customers/export/csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("Name");
    expect(text).toContain("Test Corp");
  });

  test("export products CSV", async () => {
    const res = await authed("/api/v1/products/export/csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("Name");
    expect(text).toContain("Web Design");
  });

  test("create credit note from paid invoice", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}/credit-note`, { method: "POST" });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.data.type).toBe("credit_note");
    expect(data.data.reference_invoice_id).toBe(invoiceId);
    expect(data.data.invoice_number).toMatch(/^CN-/);
    expect(data.data.status).toBe("draft");
    // Items should have negative unit_price
    expect(data.data.items.length).toBe(2);
    expect(data.data.items[0].unit_price).toBeLessThan(0);
    expect(data.data.total).toBeLessThan(0);
  });

  test("list credit notes for invoice", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}/credit-notes`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.length).toBe(1);
    expect(data.data[0].type).toBe("credit_note");
  });

  test("credit notes not shown in default invoice list", async () => {
    const res = await authed("/api/v1/invoices?limit=100");
    const data = (await res.json()) as any;
    for (const inv of data.data.items) {
      expect(inv.type).not.toBe("credit_note");
    }
  });

  test("credit notes shown with type=credit_note filter", async () => {
    const res = await authed("/api/v1/invoices?type=credit_note&limit=100");
    const data = (await res.json()) as any;
    expect(data.data.items.length).toBeGreaterThan(0);
    for (const inv of data.data.items) {
      expect(inv.type).toBe("credit_note");
    }
  });

  test("cannot create credit note from draft invoice", async () => {
    // The duplicate invoice is in draft status
    const listRes = await authed("/api/v1/invoices?status=draft");
    const listData = (await listRes.json()) as any;
    const draftId = listData.data.items[0]?.id;
    if (draftId) {
      const res = await authed(`/api/v1/invoices/${draftId}/credit-note`, { method: "POST" });
      expect(res.status).toBe(400);
    }
  });

  // Payment tests
  test("record partial payment", async () => {
    // Create a new invoice for payment testing
    const custRes = await authed("/api/v1/customers", {
      method: "POST",
      body: JSON.stringify({ name: "Payment Test Corp" }),
    });
    const custData = (await custRes.json()) as any;
    const invRes = await authed("/api/v1/invoices", {
      method: "POST",
      body: JSON.stringify({
        customer_id: custData.data.id,
        issue_date: "2026-04-01",
        due_date: "2026-05-01",
        items: [{ description: "Service", quantity: 1, unit_price: 1000, tax_rate: 0 }],
      }),
    });
    const invData = (await invRes.json()) as any;
    const payInvId = invData.data.id;

    // Mark as sent first
    await authed(`/api/v1/invoices/${payInvId}/mark-sent`, { method: "POST" });

    // Record partial payment
    const payRes = await authed(`/api/v1/invoices/${payInvId}/payments`, {
      method: "POST",
      body: JSON.stringify({ amount: 500, payment_date: "2026-04-05", method: "bank_transfer" }),
    });
    expect(payRes.status).toBe(201);

    // Check invoice is partially_paid
    const invCheck = await authed(`/api/v1/invoices/${payInvId}`);
    const invCheckData = (await invCheck.json()) as any;
    expect(invCheckData.data.status).toBe("partially_paid");
    expect(invCheckData.data.amount_paid).toBe(500);
  });

  test("record full payment makes invoice paid", async () => {
    // Use a fresh sent invoice
    const custRes = await authed("/api/v1/customers", {
      method: "POST",
      body: JSON.stringify({ name: "Full Pay Corp" }),
    });
    const custData = (await custRes.json()) as any;
    const invRes = await authed("/api/v1/invoices", {
      method: "POST",
      body: JSON.stringify({
        customer_id: custData.data.id,
        issue_date: "2026-04-01",
        items: [{ description: "Service", quantity: 1, unit_price: 200, tax_rate: 0 }],
      }),
    });
    const invData = (await invRes.json()) as any;
    const payInvId = invData.data.id;
    await authed(`/api/v1/invoices/${payInvId}/mark-sent`, { method: "POST" });

    await authed(`/api/v1/invoices/${payInvId}/payments`, {
      method: "POST",
      body: JSON.stringify({ amount: 200, payment_date: "2026-04-05" }),
    });

    const invCheck = await authed(`/api/v1/invoices/${payInvId}`);
    const invCheckData = (await invCheck.json()) as any;
    expect(invCheckData.data.status).toBe("paid");
    expect(invCheckData.data.amount_paid).toBe(200);
  });

  test("cannot record payment on draft invoice", async () => {
    const listRes = await authed("/api/v1/invoices?status=draft&limit=1");
    const listData = (await listRes.json()) as any;
    const draftId = listData.data.items[0]?.id;
    if (draftId) {
      const res = await authed(`/api/v1/invoices/${draftId}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount: 100, payment_date: "2026-04-05" }),
      });
      expect(res.status).toBe(400);
    }
  });

  test("list payments for invoice", async () => {
    // Use an invoice that has payments from previous tests
    const listRes = await authed("/api/v1/invoices?status=paid&limit=1");
    const listData = (await listRes.json()) as any;
    const paidInvId = listData.data.items[0]?.id;
    if (paidInvId) {
      const res = await authed(`/api/v1/invoices/${paidInvId}/payments`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.data.length).toBeGreaterThan(0);
    }
  });

  test("send invoice fails when SMTP not configured", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}/send`, {
      method: "POST",
      body: JSON.stringify({ to: "test@example.com" }),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as any;
    expect(data.error).toContain("not configured");
  });

  // Recurring invoice tests
  let recurringId: string;

  test("create recurring schedule", async () => {
    const res = await authed("/api/v1/recurring-invoices", {
      method: "POST",
      body: JSON.stringify({
        customer_id: customerId,
        template_invoice_id: invoiceId,
        frequency: "monthly",
        interval_value: 1,
        next_run_date: "2026-04-01",
      }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.data.status).toBe("active");
    expect(data.data.frequency).toBe("monthly");
    recurringId = data.data.id;
  });

  test("generate invoice from recurring", async () => {
    const res = await authed(`/api/v1/recurring-invoices/${recurringId}/generate-now`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.invoice_id).toBeDefined();

    // Check recurring was updated
    const recRes = await authed(`/api/v1/recurring-invoices/${recurringId}`);
    const recData = (await recRes.json()) as any;
    expect(recData.data.total_generated).toBe(1);
    expect(recData.data.next_run_date).toBe("2026-05-01");
  });

  test("pause and resume recurring", async () => {
    await authed(`/api/v1/recurring-invoices/${recurringId}/pause`, { method: "POST" });
    let res = await authed(`/api/v1/recurring-invoices/${recurringId}`);
    let data = (await res.json()) as any;
    expect(data.data.status).toBe("paused");

    await authed(`/api/v1/recurring-invoices/${recurringId}/resume`, { method: "POST" });
    res = await authed(`/api/v1/recurring-invoices/${recurringId}`);
    data = (await res.json()) as any;
    expect(data.data.status).toBe("active");
  });

  test("list recurring invoices", async () => {
    const res = await authed("/api/v1/recurring-invoices");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.length).toBeGreaterThan(0);
  });

  // Reports tests
  test("tax summary report", async () => {
    const res = await authed("/api/v1/reports/tax-summary");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.rows).toBeDefined();
    expect(data.data.totals).toBeDefined();
  });

  test("aging report", async () => {
    const res = await authed("/api/v1/reports/aging");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBe(5); // 5 buckets
  });

  test("revenue by customer report", async () => {
    const res = await authed("/api/v1/reports/revenue-by-customer");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(Array.isArray(data.data)).toBe(true);
  });

  test("revenue by product report", async () => {
    const res = await authed("/api/v1/reports/revenue-by-product");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(Array.isArray(data.data.rows)).toBe(true);
    expect(Array.isArray(data.data.months)).toBe(true);
  });

  test("tax summary CSV export", async () => {
    const res = await authed("/api/v1/reports/tax-summary/csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
  });

  // Quotes tests
  let quoteId: string;

  test("create quote", async () => {
    const res = await authed("/api/v1/quotes", {
      method: "POST",
      body: JSON.stringify({
        customer_id: quoteCustomerId,
        issue_date: "2026-04-01",
        valid_until: "2026-05-01",
        items: [{ description: "Consulting", quantity: 10, unit_price: 150, tax_rate: 0 }],
      }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.data.quote_number).toMatch(/^QT-/);
    expect(data.data.status).toBe("draft");
    expect(data.data.total).toBe(1500);
    quoteId = data.data.id;
  });

  test("send quote", async () => {
    const res = await authed(`/api/v1/quotes/${quoteId}/send`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.status).toBe("sent");
  });

  test("accept quote", async () => {
    const res = await authed(`/api/v1/quotes/${quoteId}/accept`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.status).toBe("accepted");
  });

  test("convert quote to invoice", async () => {
    const res = await authed(`/api/v1/quotes/${quoteId}/convert`, { method: "POST" });
    expect(res.status).toBe(201);
    const data = (await res.json()) as any;
    expect(data.data.invoice_id).toBeDefined();

    // Verify quote is now converted
    const qRes = await authed(`/api/v1/quotes/${quoteId}`);
    const qData = (await qRes.json()) as any;
    expect(qData.data.status).toBe("converted");
    expect(qData.data.converted_invoice_id).toBe(data.data.invoice_id);
  });

  test("cannot convert already converted quote", async () => {
    const res = await authed(`/api/v1/quotes/${quoteId}/convert`, { method: "POST" });
    expect(res.status).toBe(400);
  });

  test("list quotes", async () => {
    const res = await authed("/api/v1/quotes");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.items.length).toBeGreaterThan(0);
  });

  // Activity log tests
  test("activity log has entries from login and invoice actions", async () => {
    const res = await authed("/api/v1/activity?limit=50");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.data.items.length).toBeGreaterThan(0);
    // Should have at least a login entry
    const loginEntry = data.data.items.find((e: any) => e.action === "login");
    expect(loginEntry).toBeDefined();
  });

  test("activity log filters by resource_type", async () => {
    const res = await authed("/api/v1/activity?resource_type=invoice&limit=50");
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    for (const entry of data.data.items) {
      expect(entry.resource_type).toBe("invoice");
    }
  });

  test("resource-specific activity", async () => {
    const res = await authed(`/api/v1/activity/resource/invoice/${invoiceId}`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(Array.isArray(data.data)).toBe(true);
  });

  test("backup endpoint returns all data", async () => {
    const res = await authed("/api/v1/export/backup");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("inkvoice-backup-");
    const data = (await res.json()) as any;
    expect(data.version).toBe("1.0");
    expect(data.exported_at).toBeDefined();
    expect(data.data.settings).toBeDefined();
    expect(data.data.customers.length).toBeGreaterThan(0);
    expect(data.data.invoices.length).toBeGreaterThan(0);
    expect(data.data.products.length).toBeGreaterThan(0);
    expect(data.data.users.length).toBeGreaterThan(0);
    // Ensure password hashes are excluded
    for (const user of data.data.users) {
      expect(user.password_hash).toBeUndefined();
    }
  });
});
