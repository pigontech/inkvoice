import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import type { Hono } from "hono";
import { createApp } from "../app";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { resolveEinvoiceFormat } from "../services/einvoice.service";
import { parseEinvoiceXml } from "../services/einvoice-inbox.service";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-einvoice.db";
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

describe("E-invoice emission", () => {
  let customerId: string;
  let invoiceId: string;
  let govCustomerId: string;
  let govInvoiceId: string;

  test("setup customers", async () => {
    const res = await authed("/api/v1/customers", {
      method: "POST",
      body: JSON.stringify({
        name: "Kunde GmbH",
        email: "kunde@example.com",
        country: "DE",
        tax_id: "DE987654321",
        address_line1: "Marktplatz 2",
        city: "Hamburg",
        postal_code: "20095",
        einvoice_format: "zugferd",
      }),
    });
    customerId = ((await res.json()) as any).data.id;

    const gov = await authed("/api/v1/customers", {
      method: "POST",
      body: JSON.stringify({
        name: "Stadtverwaltung",
        country: "DE",
        leitweg_id: "04011000-1234512345-06",
      }),
    });
    govCustomerId = ((await gov.json()) as any).data.id;
  });

  test("setup company settings + invoices", async () => {
    const putRes = await authed("/api/v1/settings", {
      method: "PUT",
      body: JSON.stringify({
        company_name: "Muster GmbH",
        company_tax_id: "DE123456789",
        company_tax_number: "12/345/67890",
        company_country: "DE",
        company_street: "Hauptstraße 1",
        company_city: "Berlin",
        company_postal_code: "10115",
        company_bank_details: "IBAN DE89 3704 0044 0532 0130 00",
        einvoice_enabled: "true",
      }),
    });
    expect(putRes.status).toBe(200);
    const settingsBody = (await putRes.json()) as any;
    expect(settingsBody.data.company_name).toBe("Muster GmbH");

    const inv = await authed("/api/v1/invoices", {
      method: "POST",
      body: JSON.stringify({
        customer_id: customerId,
        issue_date: "2026-08-01",
        currency: "EUR",
        items: [
          { description: "Beratung", quantity: 2, unit_price: 500 },
          { description: "Dokumentation", quantity: 1, unit_price: 200 },
        ],
      }),
    });
    invoiceId = ((await inv.json()) as any).data.id;

    const gov = await authed("/api/v1/invoices", {
      method: "POST",
      body: JSON.stringify({
        customer_id: govCustomerId,
        issue_date: "2026-08-01",
        currency: "EUR",
        items: [{ description: "Planung", quantity: 1, unit_price: 900 }],
      }),
    });
    govInvoiceId = ((await gov.json()) as any).data.id;
  });

  test("emit ZUGFeRD hybrid PDF", async () => {
    const res = await authed(`/api/v1/invoices/${invoiceId}/einvoice/emit`, { method: "POST" });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data.format).toBe("zugferd");
    expect(data.xml).toContain("CrossIndustryInvoice");
    expect(data.xml).toContain("Muster GmbH");
    expect(data.xml).toContain("DE123456789");
    expect(data.pdf).toBeTruthy();

    // JSON transport encodes the byte array as an index-keyed object.
    const pdfArr = Array.isArray(data.pdf) ? data.pdf : Object.values(data.pdf);
    const pdfText = new TextDecoder().decode(new Uint8Array(pdfArr as number[]));
    expect(pdfText.includes("%PDF-")).toBe(true);
    expect(data.issues).toEqual([]);
  });

  test("emit XRechnung for Leitweg-ID customer", async () => {
    const res = await authed(`/api/v1/invoices/${govInvoiceId}/einvoice/emit`, { method: "POST" });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    expect(data.format).toBe("xrechnung-ubl");
    expect(data.xml).toContain("Invoice");
    expect(data.xml).toContain("urn:oasis:names:specification:ubl");
    expect(data.xml).toContain("04011000-1234512345-06");
    expect(data.pdf).toBeNull();
  });

  test("list + download records", async () => {
    const list = await authed(`/api/v1/invoices/${invoiceId}/einvoices`);
    expect(list.status).toBe(200);
    const items = ((await list.json()) as any).data;
    expect(items.length).toBe(1);
    expect(items[0].has_xml).toBe(1);
    expect(items[0].has_pdf).toBe(1);

    const xmlRes = await authed(`/api/v1/invoices/${invoiceId}/einvoices/${items[0].id}/xml`);
    expect(xmlRes.status).toBe(200);
    expect(await xmlRes.text()).toContain("CrossIndustryInvoice");

    const pdfRes = await authed(`/api/v1/invoices/${invoiceId}/einvoices/${items[0].id}/pdf`);
    expect(pdfRes.status).toBe(200);
    const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
    expect(new TextDecoder().decode(pdfBytes).includes("%PDF-")).toBe(true);
  });
});

describe("E-invoice inbox", () => {
  test("import + parse CII (ZUGFeRD) XML", async () => {
    const cii = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument><ram:ID>RE-IN-4711</ram:ID><ram:IssueDateTime><udt:DateTimeString format="102">2026-07-15</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>Lieferant AG</ram:Name><ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE111222333</ram:ID></ram:SpecifiedTaxRegistration></ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>Einkäufer GmbH</ram:Name></ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:GrandTotalAmount>1234.56</ram:GrandTotalAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
    const form = new FormData();
    form.append("file", new File([cii], "rechnung.xml", { type: "application/xml" }));

    const res = await authed("/api/v1/einvoices/inbox/import", { method: "POST", body: form });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as any;
    expect(data.duplicate).toBe(false);

    const itemRes = await authed(`/api/v1/einvoices/inbox/${data.id}`);
    const item = ((await itemRes.json()) as any).data;
    expect(item.parse_status).toBe("ok");
    expect(item.document_number).toBe("RE-IN-4711");
    expect(item.issue_date).toBe("2026-07-15");
    expect(item.supplier_name).toBe("Lieferant AG");
    expect(item.supplier_vat_id).toBe("DE111222333");
    expect(item.currency).toBe("EUR");
    expect(item.total).toBe(1234.56);

    // duplicate import is rejected
    const dup = await authed("/api/v1/einvoices/inbox/import", { method: "POST", body: form });
    expect(dup.status).toBe(200);
    expect(((await dup.json()) as any).data.duplicate).toBe(true);
  });

  test("parse UBL (XRechnung) XML", async () => {
    const parsed = parseEinvoiceXml(`<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <cbc:ID xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">XRE-99</cbc:ID>
  <cbc:IssueDate xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">2026-06-01</cbc:IssueDate>
  <cbc:DocumentCurrencyCode xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
    <cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Lieferant AG</cbc:RegistrationName></cac:PartyLegalEntity>
    <cac:PartyTaxScheme><cbc:CompanyID>DE111222333</cbc:CompanyID></cac:PartyTaxScheme></cac:Party>
  </cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal><cbc:TaxInclusiveAmount currencyID="EUR">999.99</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal>
</Invoice>`);
    expect(parsed.document_number).toBe("XRE-99");
    expect(parsed.issue_date).toBe("2026-06-01");
    expect(parsed.supplier_name).toBe("Lieferant AG");
    expect(parsed.supplier_vat_id).toBe("DE111222333");
    expect(parsed.total).toBe(999.99);
    expect(parsed.currency).toBe("EUR");
  });

  test("status transitions + raw download", async () => {
    const list = await authed("/api/v1/einvoices/inbox");
    expect(list.status).toBe(200);
    const items = ((await list.json()) as any).data;
    const first = items[0];

    const raw = await authed(`/api/v1/einvoices/inbox/${first.id}/raw`);
    expect(raw.status).toBe(200);
    expect(await raw.text()).toContain("CrossIndustryInvoice");

    const status = await authed(`/api/v1/einvoices/inbox/${first.id}/status`, {
      method: "POST",
      body: JSON.stringify({ status: "processed" }),
    });
    expect(status.status).toBe(200);

    const del = await authed(`/api/v1/einvoices/inbox/${first.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
  });
});

describe("E-invoice format resolution", () => {
  test("customer override wins; Leitweg-ID forces XRechnung", () => {
    expect(resolveEinvoiceFormat({ customerFormat: "xrechnung", settingFormat: "zugferd" })).toBe(
      "xrechnung-ubl",
    );
    expect(resolveEinvoiceFormat({ customerFormat: null, settingFormat: null })).toBe("zugferd");
    expect(resolveEinvoiceFormat({ customerFormat: "zugferd", leitwegId: "0401-1-1" })).toBe(
      "xrechnung-ubl",
    );
  });
});
