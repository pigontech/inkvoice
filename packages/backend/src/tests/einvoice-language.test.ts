import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { inflateSync } from "node:zlib";
import type { Hono } from "hono";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
import { createApp } from "../app";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { buildEinvoicePdf } from "../services/einvoice-pdf.service";
import { validateEinvoice } from "../services/einvoice-validator.service";
import { resetEnvCache } from "../utils/env";
import { localizePaymentTerms } from "../utils/payment-terms";
import { buildXmlInvoiceData } from "../xml/build-data";
import { FacturxZugferdProfile } from "../xml/profiles/facturx-zugferd";

// E-invoice feedback in the user's language: issue params for the panel, the
// file the send dialog names, and payment-term presets on German documents.

const TEST_DB = "./data/test-einvoice-language.db";
let app: Hono;
let token: string;

function authed(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (opts.method && opts.method !== "GET") headers["Content-Type"] = "application/json";
  return app.request(new Request(`http://localhost${path}`, { ...opts, headers }));
}

async function json(method: string, path: string, body?: unknown): Promise<any> {
  const res = await authed(path, { method, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...((await res.json()) as object) };
}

async function customer(fields: Record<string, unknown>): Promise<string> {
  const base = {
    country: "DE",
    address_line1: "Marktplatz 2",
    city: "Hamburg",
    postal_code: "20095",
    email: "buchhaltung@example.org",
  };
  return (await json("POST", "/api/v1/customers", { ...base, ...fields })).data.id;
}

async function sentInvoice(customerId: string, fields: Record<string, unknown> = {}) {
  const res = await json("POST", "/api/v1/invoices", {
    customer_id: customerId,
    issue_date: "2026-11-02",
    due_date: "2026-11-16",
    currency: "EUR",
    items: [{ description: "Beratung", quantity: 1, unit_price: 100 }],
    ...fields,
  });
  await authed(`/api/v1/invoices/${res.data.id}/mark-sent`, { method: "POST" });
  return res.data.id as string;
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

  await json("PUT", "/api/v1/settings", {
    company_name: "Muster GmbH",
    company_email: "rechnung@example.com",
    company_phone: "+49 30 1234567",
    company_tax_id: "DE123456789",
    company_country: "DE",
    company_street: "Hauptstraße 1",
    company_city: "Berlin",
    company_postal_code: "10115",
    company_iban: "DE02120300000000202051",
    einvoice_enabled: "true",
    locale: "en-US",
  });
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
});

describe("issue params", () => {
  test("issues with values in their message carry those values", async () => {
    const id = await sentInvoice(await customer({ name: "Kunde AT", country: "AT" }));
    const data = buildXmlInvoiceData(id);
    data.supplier.tax_id = "123";
    data.supplier.tax_number = "abc";
    const byCode = new Map(validateEinvoice(data).map((i) => [i.code, i]));
    expect(byCode.get("seller_vat_format")?.params).toEqual({ vat_id: "123" });
    expect(byCode.get("seller_tax_number_format")?.params).toEqual({ tax_number: "abc" });
    expect(byCode.get("buyer_vat_id")?.params).toEqual({ country: "AT" });
    // The English message stays, for API clients.
    expect(byCode.get("buyer_vat_id")?.message).toContain("Buyer is in AT");
  });

  test("issues without values have no params", async () => {
    const data = buildXmlInvoiceData(await sentInvoice(await customer({ name: "Kunde DE" })));
    data.supplier.phone = null;
    const issue = validateEinvoice(data, "xrechnung-ubl").find((i) => i.code === "xr_seller_phone");
    expect(issue).toEqual({
      severity: "error",
      code: "xr_seller_phone",
      message: "XRechnung needs your phone number (Settings). [BR-DE-6]",
    });
  });
});

describe("file the send dialog names", () => {
  // The check endpoint tells the dialog which file an email would attach.
  const attachment = async (id: string) => {
    const { data } = await json("GET", `/api/v1/invoices/${id}/einvoice/check`);
    return { format: data.format, file: data.file };
  };

  test("ZUGFeRD goes out as the hybrid PDF, or as XML when the PDF is off", async () => {
    const id = await sentInvoice(
      await customer({ name: "Zugferd GmbH", einvoice_format: "zugferd" }),
    );
    expect(await attachment(id)).toEqual({ format: "zugferd", file: "pdf" });

    await json("PUT", "/api/v1/settings", { einvoice_attach_pdf: "false" });
    expect(await attachment(id)).toEqual({ format: "zugferd", file: "xml" });
    await json("PUT", "/api/v1/settings", { einvoice_attach_pdf: "true" });
  });

  test("a Leitweg-ID or the customer's format picks XRechnung or PEPPOL XML", async () => {
    const gov = await sentInvoice(
      await customer({ name: "Stadt", leitweg_id: "04011000-1234512345-06" }),
    );
    expect(await attachment(gov)).toEqual({ format: "xrechnung-ubl", file: "xml" });

    const xr = await sentInvoice(await customer({ name: "XR GmbH", einvoice_format: "xrechnung" }));
    expect(await attachment(xr)).toEqual({ format: "xrechnung-ubl", file: "xml" });

    const peppol = await sentInvoice(await customer({ name: "BE BV", einvoice_format: "peppol" }));
    expect(await attachment(peppol)).toEqual({ format: "peppol", file: "xml" });
  });

  test("a format without a profile attaches nothing", async () => {
    const custId = await customer({ name: "CII GmbH" });
    getDb()
      .query("UPDATE customers SET einvoice_format = 'xrechnung-cii' WHERE id = ?")
      .run(custId);
    expect(await attachment(await sentInvoice(custId))).toEqual({
      format: "xrechnung-cii",
      file: null,
    });
  });
});

describe("payment terms presets", () => {
  test("print in the document's language; custom text and English stay as typed", () => {
    expect(localizePaymentTerms("Net 14", "de-DE")).toBe(
      "Zahlbar innerhalb von 14 Tagen ohne Abzug",
    );
    expect(localizePaymentTerms("Net 1", "de")).toBe("Zahlbar innerhalb von 1 Tag ohne Abzug");
    expect(localizePaymentTerms("due on receipt", "de-AT")).toBe("Zahlbar sofort ohne Abzug");
    expect(localizePaymentTerms("Net 30", "fr-FR")).toBe("Paiement à 30 jours");
    expect(localizePaymentTerms("Net 30", "es-ES")).toBe("Pago a 30 días");
    expect(localizePaymentTerms("Net 30", "tr-TR")).toBe(
      "Fatura tarihinden itibaren 30 gün içinde ödenir",
    );
    expect(localizePaymentTerms("Net 30", "en-US")).toBe("Net 30");
    expect(localizePaymentTerms("Net 30", "it-IT")).toBe("Net 30");
    expect(localizePaymentTerms("14 Tage netto", "de-DE")).toBe("14 Tage netto");
    expect(localizePaymentTerms("Net 14 days", "de-DE")).toBe("Net 14 days");
    expect(localizePaymentTerms("", "de-DE")).toBeNull();
    expect(localizePaymentTerms(null, "de-DE")).toBeNull();
  });

  test("a German customer's invoice has German terms in the PDF and both XML formats", async () => {
    const zugferd = await sentInvoice(
      await customer({ name: "Kunde GmbH", language: "de-DE", einvoice_format: "zugferd" }),
      { payment_terms: "Net 14" },
    );
    const german = "Zahlbar innerhalb von 14 Tagen ohne Abzug";

    const preview = await authed(`/api/v1/invoices/${zugferd}/preview`);
    const html = await preview.text();
    expect(html).toContain(german);
    expect(html).not.toContain("Net 14");

    const cii = (await json("POST", `/api/v1/invoices/${zugferd}/einvoice/emit`)).data.xml;
    expect(cii).toContain(`<ram:Description>${german}</ram:Description>`);

    const xrechnung = await sentInvoice(
      await customer({ name: "Amt", language: "de-DE", leitweg_id: "04011000-1234512345-06" }),
      { payment_terms: "Net 14" },
    );
    const ubl = (await json("POST", `/api/v1/invoices/${xrechnung}/einvoice/emit`)).data.xml;
    expect(ubl).toContain(`<cbc:Note>${german}</cbc:Note>`);

    // The stored value stays the English preset.
    const stored = (await json("GET", `/api/v1/invoices/${zugferd}`)).data.payment_terms;
    expect(stored).toBe("Net 14");
  });

  test("the invoice locale wins over the customer's language, then the workspace locale", async () => {
    const custId = await customer({ name: "Kunde DE", language: "de-DE" });
    const english = await sentInvoice(custId, { payment_terms: "Net 30", locale: "en-US" });
    expect(buildXmlInvoiceData(english).payment_terms).toBe("Net 30");

    const plain = await customer({ name: "Kunde ohne Sprache" });
    const workspace = await sentInvoice(plain, { payment_terms: "Net 30" });
    expect(buildXmlInvoiceData(workspace).payment_terms).toBe("Net 30");
    await json("PUT", "/api/v1/settings", { locale: "de-DE" });
    expect(buildXmlInvoiceData(workspace).payment_terms).toBe(
      "Zahlbar innerhalb von 30 Tagen ohne Abzug",
    );
    await json("PUT", "/api/v1/settings", { locale: "en-US" });
  });
});

describe("ZUGFeRD PDF number and date formatting", () => {
  test("respects customer preferred language and configured date_format", async () => {
    await json("PUT", "/api/v1/settings", {
      number_format: "1,000.00",
      date_format: "DD.MM.YYYY",
    });
    const custId = await customer({
      name: "Kunde Deutsch",
      language: "de-DE",
      einvoice_format: "zugferd",
    });
    const invId = await sentInvoice(custId, {
      issue_date: "2026-11-12",
      due_date: "2026-11-26",
      items: [{ description: "Beratung", quantity: 1, unit_price: 1234.56 }],
    });
    const data = buildXmlInvoiceData(invId);
    const { pdfBytes } = await buildEinvoicePdf({
      data,
      facturXml: new FacturxZugferdProfile().generateXml(data),
    });
    const runs = await pdfTextRuns(pdfBytes);
    expect(runs).toContain("1.234,56\u00a0€");
    expect(runs).not.toContain("€1,234.56");
    expect(runs).toContain("26.11.2026");

    await json("PUT", "/api/v1/settings", { date_format: "YYYY-MM-DD" });
  });

  test("respects workspace number_format when customer has no language override", async () => {
    await json("PUT", "/api/v1/settings", {
      number_format: "1.000,00",
      date_format: "YYYY-MM-DD",
    });
    const custId = await customer({ name: "Kunde Standard", einvoice_format: "zugferd" });
    const invId = await sentInvoice(custId, {
      issue_date: "2026-11-12",
      due_date: "2026-11-26",
      items: [{ description: "Beratung", quantity: 1, unit_price: 1234.56 }],
    });
    const data = buildXmlInvoiceData(invId);
    const { pdfBytes } = await buildEinvoicePdf({
      data,
      facturXml: new FacturxZugferdProfile().generateXml(data),
    });
    const runs = await pdfTextRuns(pdfBytes);
    expect(runs).toContain("1.234,56\u00a0€");
    expect(runs).not.toContain("€1,234.56");
    expect(runs).toContain("2026-11-26");

    await json("PUT", "/api/v1/settings", { number_format: "1,000.00" });
  });
});

function inflateStream(stream: PDFRawStream): string {
  const filter = stream.dict.lookup(PDFName.of("Filter"));
  const bytes =
    filter === PDFName.of("FlateDecode") ? inflateSync(stream.contents) : stream.contents;
  return new TextDecoder("latin1").decode(bytes);
}

async function pdfTextRuns(pdfBytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const page = pdf.getPages()[0];
  const resources = page.node.lookup(PDFName.of("Resources"), PDFDict);
  const fonts = resources.lookup(PDFName.of("Font"), PDFDict);
  const glyphToChar = new Map<number, string>();

  for (const [, ref] of fonts.entries()) {
    const fontDict = pdf.context.lookup(ref, PDFDict);
    const toUnicode = fontDict.lookup(PDFName.of("ToUnicode"));
    if (!(toUnicode instanceof PDFRawStream)) continue;
    const cmap = inflateStream(toUnicode);
    for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const cps: number[] = [];
        for (let i = 0; i < m[2].length; i += 4) {
          cps.push(Number.parseInt(m[2].slice(i, i + 4), 16));
        }
        glyphToChar.set(Number.parseInt(m[1], 16), String.fromCodePoint(...cps));
      }
    }
    for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const m of block[1].matchAll(
        /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
      )) {
        const start = Number.parseInt(m[1], 16);
        const end = Number.parseInt(m[2], 16);
        let target = Number.parseInt(m[3], 16);
        for (let g = start; g <= end; g++, target++) {
          glyphToChar.set(g, String.fromCodePoint(target));
        }
      }
    }
  }

  const contentsEntry = page.node.get(PDFName.of("Contents"));
  const streams: PDFRawStream[] = [];
  if (contentsEntry instanceof PDFRef) {
    const looked = pdf.context.lookup(contentsEntry);
    if (looked instanceof PDFRawStream) streams.push(looked);
    else if (looked instanceof PDFArray) {
      for (let i = 0; i < looked.size(); i++) {
        const s = looked.lookup(i);
        if (s instanceof PDFRawStream) streams.push(s);
      }
    }
  } else if (contentsEntry instanceof PDFArray) {
    for (let i = 0; i < contentsEntry.size(); i++) {
      const s = contentsEntry.lookup(i);
      if (s instanceof PDFRawStream) streams.push(s);
    }
  }

  const content = streams.map(inflateStream).join("\n");
  const runs: string[] = [];
  for (const m of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
    const hex = m[1];
    let decoded = "";
    for (let i = 0; i < hex.length; i += 4) {
      const gid = Number.parseInt(hex.slice(i, i + 4), 16);
      decoded += glyphToChar.get(gid) ?? "";
    }
    runs.push(decoded);
  }
  return runs;
}
