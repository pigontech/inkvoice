import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { validateEinvoice } from "../services/einvoice-validator.service";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-einvoice-france.db";
let app: Hono;
let token: string;

function authed(path: string, opts: RequestInit = {}) {
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
  token = ((await res.json()) as any).data.token;
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
});

describe("Factur-X French buyer ID", () => {
  let sirenCustomerId: string;
  let siretCustomerId: string;
  let invoiceId: string;
  let siretInvoiceId: string;

  test("setup France customers + invoices", async () => {
    const siren = await authed("/api/v1/customers", {
      method: "POST",
      body: JSON.stringify({
        name: "Client SAS",
        country: "FR",
        siren: "123456789",
        address_line1: "1 rue de la Paix",
        city: "Paris",
        postal_code: "75002",
      }),
    });
    sirenCustomerId = ((await siren.json()) as any).data.id;

    const siret = await authed("/api/v1/customers", {
      method: "POST",
      body: JSON.stringify({
        name: "Client SARL",
        country: "FR",
        siret: "98765432100012",
        address_line1: "2 avenue des Champs",
        city: "Lyon",
        postal_code: "69001",
      }),
    });
    siretCustomerId = ((await siret.json()) as any).data.id;

    await authed("/api/v1/settings", {
      method: "PUT",
      body: JSON.stringify({
        company_name: "Editeur FR",
        company_tax_id: "FR12345678901",
        company_country: "FR",
        company_street: "5 rue Test",
        company_city: "Paris",
        company_postal_code: "75001",
        einvoice_enabled: "true",
      }),
    });

    const inv = await authed("/api/v1/invoices", {
      method: "POST",
      body: JSON.stringify({
        customer_id: sirenCustomerId,
        issue_date: "2026-08-14",
        currency: "EUR",
        items: [{ description: "Prestation", quantity: 1, unit_price: 1000 }],
      }),
    });
    invoiceId = ((await inv.json()) as any).data.id;
    await authed(`/api/v1/invoices/${invoiceId}/mark-sent`, { method: "POST" });

    const inv2 = await authed("/api/v1/invoices", {
      method: "POST",
      body: JSON.stringify({
        customer_id: siretCustomerId,
        issue_date: "2026-08-14",
        currency: "EUR",
        items: [{ description: "Prestation 2", quantity: 1, unit_price: 500 }],
      }),
    });
    siretInvoiceId = ((await inv2.json()) as any).data.id;
    await authed(`/api/v1/invoices/${siretInvoiceId}/mark-sent`, { method: "POST" });
  });

  test("emits buyer SIREN with schemeID 0009", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}/einvoice/emit`, { method: "POST" });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data.format).toBe("zugferd");
    expect(data.xml).toContain(`<ram:ID schemeID="0009">123456789</ram:ID>`);
    expect(data.xml).not.toContain(`schemeID="0002"`);
  });

  test("emits buyer SIRET with schemeID 0002 when no SIREN", async () => {
    const res = await authed(`/api/v1/invoices/${siretInvoiceId}/einvoice/emit`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data.xml).toContain(`<ram:ID schemeID="0002">98765432100012</ram:ID>`);
    expect(data.xml).not.toContain(`schemeID="0009"`);
  });

  describe("Franchise en base de TVA", () => {
    let customerId: string;
    let invoiceId: string;

    test("setup zero-VAT invoice", async () => {
      const cust = await authed("/api/v1/customers", {
        method: "POST",
        body: JSON.stringify({
          name: "Micro Entreprise",
          country: "FR",
          siren: "111222333",
          address_line1: "3 rue du Commerce",
          city: "Nantes",
          postal_code: "44000",
        }),
      });
      customerId = ((await cust.json()) as any).data.id;
      const inv = await authed("/api/v1/invoices", {
        method: "POST",
        body: JSON.stringify({
          customer_id: customerId,
          issue_date: "2026-08-14",
          currency: "EUR",
          items: [{ description: "Vente", quantity: 1, unit_price: 200 }],
          items_tax: [], // no tax definitions → 0% lines
        }),
      });
      invoiceId = ((await inv.json()) as any).data.id;
      await authed(`/api/v1/invoices/${invoiceId}/mark-sent`, { method: "POST" });
    });

    test("franchise on → category E + exemption reason; off → category Z", async () => {
      await authed("/api/v1/settings", {
        method: "PUT",
        body: JSON.stringify({ einvoice_franchise_fr: "true" }),
      });
      const on = await authed(`/api/v1/invoices/${invoiceId}/einvoice/emit`, { method: "POST" });
      const onData = (await on.json()) as any;
      expect(onData.data.xml).toContain(`<ram:CategoryCode>E</ram:CategoryCode>`);
      expect(onData.data.xml).toContain(
        `<ram:ExemptionReason>TVA non applicable, art. 293 B du CGI</ram:ExemptionReason>`,
      );

      await authed("/api/v1/settings", {
        method: "PUT",
        body: JSON.stringify({ einvoice_franchise_fr: "false" }),
      });
      const off = await authed(`/api/v1/invoices/${invoiceId}/einvoice/emit`, { method: "POST" });
      const offData = (await off.json()) as any;
      expect(offData.data.xml).not.toContain(`<ram:CategoryCode>E</ram:CategoryCode>`);
      expect(offData.data.xml).not.toContain("ExemptionReason");
    });
  });
});

describe("Validator France warnings", () => {
  test("FR buyer without SIREN warns when France is enabled", () => {
    const issues = validateEinvoice({
      invoice_number: "INV-FR-1",
      issue_date: "2026-08-14",
      due_date: null,
      currency: "EUR",
      locale: null,
      type: "invoice",
      notes: null,
      payment_terms: null,
      subtotal: 100,
      tax_total: 20,
      discount_amount: 0,
      total: 120,
      france_enabled: true,
      supplier: {
        name: "Editeur FR",
        email: null,
        phone: null,
        address: null,
        street: "5 rue Test",
        city: "Paris",
        postal_code: "75001",
        country: "FR",
        tax_id: "FR12345678901",
        tax_number: null,
        bank_details: null,
        peppol_endpoint_id: null,
        peppol_scheme_id: null,
      },
      customer: {
        name: "Client SAS",
        email: null,
        phone: null,
        address_line1: "1 rue de la Paix",
        address_line2: null,
        city: "Paris",
        state: null,
        postal_code: "75002",
        country: "FR",
        tax_id: null,
        tax_number: null,
        einvoice_format: null,
        leitweg_id: null,
        einvoice_receiver_id: null,
        einvoice_receiver_scheme: null,
        siren: null,
        siret: null,
      },
      items: [],
      tax_breakdown: [],
    } as any);
    expect(issues.some((i) => i.code === "buyer_siren_fr")).toBe(true);
  });

  test("no warning when SIREN present", () => {
    const issues = validateEinvoice({
      invoice_number: "INV-FR-2",
      issue_date: "2026-08-14",
      due_date: null,
      currency: "EUR",
      locale: null,
      type: "invoice",
      notes: null,
      payment_terms: null,
      subtotal: 100,
      tax_total: 20,
      discount_amount: 0,
      total: 120,
      france_enabled: true,
      supplier: {
        name: "Editeur FR",
        email: null,
        phone: null,
        address: null,
        street: "5 rue Test",
        city: "Paris",
        postal_code: "75001",
        country: "FR",
        tax_id: "FR12345678901",
        tax_number: null,
        bank_details: null,
        peppol_endpoint_id: null,
        peppol_scheme_id: null,
      },
      customer: {
        name: "Client SAS",
        email: null,
        phone: null,
        address_line1: "1 rue de la Paix",
        address_line2: null,
        city: "Paris",
        state: null,
        postal_code: "75002",
        country: "FR",
        tax_id: null,
        tax_number: null,
        einvoice_format: null,
        leitweg_id: null,
        einvoice_receiver_id: null,
        einvoice_receiver_scheme: null,
        siren: "123456789",
        siret: null,
      },
      items: [],
      tax_breakdown: [],
    } as any);
    expect(issues.some((i) => i.code === "buyer_siren_fr")).toBe(false);
  });

  test("franchise_fr with VAT → error franchise_fr_vat", () => {
    const issues = validateEinvoice({
      invoice_number: "INV-FR-3",
      issue_date: "2026-08-14",
      due_date: null,
      currency: "EUR",
      locale: null,
      type: "invoice",
      notes: null,
      payment_terms: null,
      subtotal: 100,
      tax_total: 20,
      discount_amount: 0,
      total: 120,
      franchise_fr: true,
      supplier: {
        name: "Editeur FR",
        email: null,
        phone: null,
        address: null,
        street: "5 rue Test",
        city: "Paris",
        postal_code: "75001",
        country: "FR",
        tax_id: "FR12345678901",
        tax_number: null,
        bank_details: null,
        peppol_endpoint_id: null,
        peppol_scheme_id: null,
      },
      customer: {
        name: "Client SAS",
        email: null,
        phone: null,
        address_line1: "1 rue de la Paix",
        address_line2: null,
        city: "Paris",
        state: null,
        postal_code: "75002",
        country: "FR",
        tax_id: null,
        tax_number: null,
        einvoice_format: null,
        leitweg_id: null,
        einvoice_receiver_id: null,
        einvoice_receiver_scheme: null,
        siren: "123456789",
        siret: null,
      },
      items: [],
      tax_breakdown: [{ tax_rate: 20, taxable_amount: 100, tax_amount: 20 }],
    } as any);
    expect(issues.some((i) => i.code === "franchise_fr_vat")).toBe(true);
  });
});
