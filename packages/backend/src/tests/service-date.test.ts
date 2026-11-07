import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import Mustache from "mustache";
import { createApp } from "../app";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { BUILTIN_TEMPLATES, readTemplateFile } from "../services/builtin-templates";
import { createCustomer } from "../services/customer.service";
import {
  createCreditNote,
  createInvoice,
  duplicateInvoice,
  getInvoice,
  markSent,
  updateInvoice,
} from "../services/invoice.service";
import { buildInvoiceContext } from "../services/pdf.service";
import { resetEnvCache } from "../utils/env";
import { buildXmlInvoiceData } from "../xml/build-data";

// The date of supply (Leistungsdatum, § 14 Abs. 4 Nr. 6 UStG): stored on the
// invoice as one date or a period, printed on the PDF and sent as BT-72/BG-14.

const TEST_DB = "./data/test-service-date.db";
let customerId = "";

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "testpass123";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  resetEnvCache();
  initDatabase();
  runMigrations();
  await seed();
  customerId = createCustomer({ name: "Kunde GmbH" }).id;
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
});

function base() {
  return {
    customer_id: customerId,
    issue_date: "2026-11-07",
    items: [{ description: "Beratung", quantity: 1, unit_price: 100, tax_rate: 19 }],
  };
}

describe("service date on invoices", () => {
  test("stores a date or a period", () => {
    const single = createInvoice({ ...base(), service_date: "2026-10-31" });
    expect(single.service_date).toBe("2026-10-31");
    expect(single.service_period_start).toBeNull();

    const period = createInvoice({
      ...base(),
      service_period_start: "2026-10-01",
      service_period_end: "2026-10-31",
    });
    expect(period.service_date).toBeNull();
    expect(period.service_period_start).toBe("2026-10-01");
    expect(period.service_period_end).toBe("2026-10-31");
  });

  test("an update without the fields keeps them, one with any of them replaces all three", () => {
    const inv = createInvoice({ ...base(), service_date: "2026-10-31" });

    const kept = updateInvoice(inv.id, { ...base(), notes: "edited" })!;
    expect(kept.notes).toBe("edited");
    expect(kept.service_date).toBe("2026-10-31");

    const replaced = updateInvoice(inv.id, {
      ...base(),
      service_period_start: "2026-10-01",
      service_period_end: "2026-10-31",
    })!;
    expect(replaced.service_date).toBeNull();
    expect(replaced.service_period_start).toBe("2026-10-01");
    expect(replaced.service_period_end).toBe("2026-10-31");

    const cleared = updateInvoice(inv.id, { ...base(), service_date: null })!;
    expect(cleared.service_date).toBeNull();
    expect(cleared.service_period_start).toBeNull();
    expect(cleared.service_period_end).toBeNull();
  });

  test("a credit note keeps the date of the invoice it corrects, a duplicate does not", () => {
    const inv = createInvoice({
      ...base(),
      service_period_start: "2026-10-01",
      service_period_end: "2026-10-31",
    });
    markSent(inv.id);

    const credit = createCreditNote(inv.id);
    expect(credit.success).toBe(true);
    if (!credit.success) return;
    expect(credit.data.service_period_start).toBe("2026-10-01");
    expect(credit.data.service_period_end).toBe("2026-10-31");

    const copy = duplicateInvoice(inv.id)!;
    expect(copy.service_period_start).toBeNull();
    expect(copy.service_period_end).toBeNull();
  });
});

describe("service date API", () => {
  async function client() {
    const app = createApp();
    const login = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "testpass123" }),
    });
    const token = ((await login.json()) as any).data.token;
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    return (method: string, path: string, body?: unknown) =>
      app.request(`/api/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
  }

  test("create and update pass the fields through, PUT without them keeps them", async () => {
    const call = await client();
    const created = await call("POST", "/invoices", { ...base(), service_date: "2026-10-31" });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as any).data.id;
    expect(getInvoice(id)!.service_date).toBe("2026-10-31");

    const kept = await call("PUT", `/invoices/${id}`, { ...base(), notes: "edited" });
    expect(kept.status).toBe(200);
    expect(((await kept.json()) as any).data.service_date).toBe("2026-10-31");

    const period = await call("PUT", `/invoices/${id}`, {
      ...base(),
      service_date: null,
      service_period_start: "2026-10-01",
      service_period_end: "2026-10-31",
    });
    expect(period.status).toBe(200);
    const periodData = ((await period.json()) as any).data;
    expect(periodData.service_date).toBeNull();
    expect(periodData.service_period_start).toBe("2026-10-01");
    expect(periodData.service_period_end).toBe("2026-10-31");

    // "" clears like null.
    const cleared = await call("PUT", `/invoices/${id}`, { ...base(), service_period_start: "" });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as any).data.service_period_end).toBeNull();
  });

  test("rejects a half period, a period that ends before it starts and invalid dates", async () => {
    const call = await client();
    const bad = [
      { service_period_start: "2026-10-01" },
      { service_period_end: "2026-10-31" },
      { service_period_start: "2026-10-31", service_period_end: "2026-10-01" },
      { service_date: "2026-02-30" },
      { service_date: "31.10.2026" },
    ];
    for (const fields of bad) {
      const res = await call("POST", "/invoices", { ...base(), ...fields });
      expect(res.status).toBe(400);
    }
    const sameDay = await call("POST", "/invoices", {
      ...base(),
      service_period_start: "2026-10-31",
      service_period_end: "2026-10-31",
    });
    expect(sameDay.status).toBe(201);
  });
});

describe("service date output", () => {
  test("the e-invoice data carries BT-72 and BG-14", () => {
    const single = createInvoice({ ...base(), service_date: "2026-10-31" });
    const singleData = buildXmlInvoiceData(single.id);
    expect(singleData.service_date).toBe("2026-10-31");
    expect(singleData.service_period).toBeNull();

    const period = createInvoice({
      ...base(),
      service_period_start: "2026-10-01",
      service_period_end: "2026-10-31",
    });
    const periodData = buildXmlInvoiceData(period.id);
    expect(periodData.service_date).toBeNull();
    expect(periodData.service_period).toEqual({ start: "2026-10-01", end: "2026-10-31" });
  });

  test("every built-in template prints the date and the period", () => {
    const single = createInvoice({ ...base(), service_date: "2026-10-31" });
    const period = createInvoice({
      ...base(),
      service_period_start: "2026-10-01",
      service_period_end: "2026-10-31",
    });
    const none = createInvoice(base());
    const singleCtx = buildInvoiceContext(single.id)!;
    const periodCtx = buildInvoiceContext(period.id)!;
    const noneCtx = buildInvoiceContext(none.id)!;
    expect(singleCtx.service_date).toBeTruthy();
    expect(periodCtx.service_period?.start).toBeTruthy();
    expect(noneCtx.service_date).toBeNull();
    expect(noneCtx.service_period).toBeNull();

    for (const tmpl of BUILTIN_TEMPLATES) {
      const html = readTemplateFile(tmpl.file);
      const german = tmpl.slug === "din5008";
      const singleHtml = Mustache.render(html, singleCtx);
      expect(singleHtml).toContain(german ? "Leistungsdatum" : "Service date");
      expect(singleHtml).toContain(singleCtx.service_date!);

      const periodHtml = Mustache.render(html, periodCtx);
      const { start, end } = periodCtx.service_period!;
      expect(periodHtml).toContain(german ? "Leistungszeitraum" : "Service period");
      expect(periodHtml).toContain(start);
      expect(periodHtml).toContain(german ? `bis ${end}` : `${start} to ${end}`);

      const noneHtml = Mustache.render(html, noneCtx);
      expect(noneHtml).not.toContain(german ? "Leistung" : "Service ");
    }
  });
});
