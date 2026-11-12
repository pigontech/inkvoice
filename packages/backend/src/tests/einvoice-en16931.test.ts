import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from "pdf-lib";
import { buildEinvoicePdf, discountText } from "../services/einvoice-pdf.service";
import { validateEinvoice } from "../services/einvoice-validator.service";
import { en16931Category, prepareEn16931 } from "../xml/en16931";
import { FacturxZugferdProfile } from "../xml/profiles/facturx-zugferd";
import { FatturaPaProfile } from "../xml/profiles/fatturapa";
import { UblPeppolProfile } from "../xml/profiles/ubl-peppol";
import { XRechnungProfile } from "../xml/profiles/xrechnung";
import type { XmlInvoiceData, XmlLineItem } from "../xml/types";

// Unit tests for the EN 16931 layer behind XRechnung and ZUGFeRD. The full
// check against the official KoSIT validator runs in CI
// (.github/workflows/einvoice-conformance.yml).

function line(over: Partial<XmlLineItem>): XmlLineItem {
  return {
    id: "l",
    description: "Beratung",
    quantity: 1,
    unit_price: 100,
    unit: "hour",
    line_total: 100,
    tax_rate: 19,
    tax_amount: 19,
    tax_category_code: "S",
    ...over,
  };
}

function invoice(over: Partial<XmlInvoiceData> = {}): XmlInvoiceData {
  return {
    invoice_number: "RE-1",
    issue_date: "2026-11-02",
    due_date: "2026-11-16",
    currency: "EUR",
    locale: "de",
    type: "invoice",
    notes: null,
    payment_terms: null,
    subtotal: 100,
    tax_total: 19,
    discount_amount: 0,
    total: 119,
    supplier: {
      name: "Anna Beispiel Design",
      email: "rechnung@example.com",
      phone: "+49 30 1234567",
      address: null,
      street: "Musterstraße 12",
      city: "Berlin",
      postal_code: "10115",
      country: "DE",
      tax_id: "DE123456789",
      tax_number: "12/345/67890",
      bank_details: null,
      iban: "DE02 1203 0000 0000 2020 51",
      bic: "BYLADEM1001",
      account_holder: "Anna Beispiel",
      peppol_endpoint_id: null,
      peppol_scheme_id: null,
    },
    customer: {
      name: "Kunde GmbH",
      email: "buchhaltung@example.org",
      phone: null,
      address_line1: "Marktplatz 2",
      address_line2: null,
      city: "Hamburg",
      state: null,
      postal_code: "20095",
      country: "DE",
      tax_id: "DE987654321",
      tax_number: null,
      einvoice_format: null,
      leitweg_id: null,
      einvoice_receiver_id: null,
      einvoice_receiver_scheme: null,
      siren: null,
      siret: null,
    },
    items: [line({})],
    tax_breakdown: [],
    ...over,
  };
}

describe("VAT categories", () => {
  test("7 % is standard rated, AA is not an EN 16931 code", () => {
    expect(en16931Category("AA", 7, {})).toBe("S");
    expect(en16931Category(null, 7, {})).toBe("S");
  });
  test("a 0 % standard-rated line becomes zero rated", () => {
    expect(en16931Category("S", 0, {})).toBe("Z");
  });
  test("Kleinunternehmer lines are exempt with the § 19 reason", () => {
    const doc = prepareEn16931(
      invoice({
        kleinunternehmer: true,
        tax_total: 0,
        total: 100,
        items: [line({ tax_rate: 0, tax_amount: 0, tax_category_code: "Z" })],
      }),
    );
    expect(doc.groups[0].category).toBe("E");
    expect(doc.groups[0].exemptionReason).toBe("Kleinunternehmer gemäß § 19 UStG");
  });
  test("reverse charge carries the VATEX code and the note", () => {
    const doc = prepareEn16931(
      invoice({
        tax_total: 0,
        total: 100,
        items: [line({ tax_rate: 0, tax_amount: 0, tax_category_code: "AE" })],
      }),
    );
    expect(doc.groups[0].exemptionCode).toBe("VATEX-EU-AE");
    expect(doc.notes.some((n) => n.includes("Steuerschuldnerschaft"))).toBe(true);
  });
});

describe("amounts", () => {
  test("credit notes carry positive amounts and prices", () => {
    const doc = prepareEn16931(
      invoice({
        type: "credit_note",
        subtotal: -100,
        tax_total: -19,
        total: -119,
        items: [line({ unit_price: -100, line_total: -100, tax_amount: -19 })],
      }),
    );
    expect(doc.lines[0].price).toBe(100);
    expect(doc.lines[0].quantity).toBe(1);
    expect(doc.grandTotal).toBe(119);
  });

  test("a negative line is a negative quantity at a positive price", () => {
    const doc = prepareEn16931(
      invoice({
        subtotal: 50,
        tax_total: 9.5,
        total: 59.5,
        items: [
          line({}),
          line({ quantity: 1, unit_price: -50, line_total: -50, tax_amount: -9.5 }),
        ],
      }),
    );
    expect(doc.lines[1]).toMatchObject({ quantity: -1, price: 50, net: -50 });
    expect(doc.lineTotal).toBe(50);
  });

  test("a document discount is split per VAT rate and lowers each base", () => {
    // 420 at 19 % and 300 at 7 %, 50 off (as calculateInvoiceTotals does it)
    const doc = prepareEn16931(
      invoice({
        subtotal: 720,
        discount_amount: 50,
        tax_total: 93.8,
        total: 763.8,
        items: [
          line({ quantity: 6, unit_price: 70, line_total: 420, tax_amount: 79.8 }),
          line({ unit_price: 300, line_total: 300, tax_rate: 7, tax_amount: 21 }),
        ],
      }),
    );
    expect(doc.groups.map((g) => g.allowance)).toEqual([29.17, 20.83]);
    expect(doc.groups.map((g) => g.taxable)).toEqual([390.83, 279.17]);
    expect(doc.groups.map((g) => g.tax)).toEqual([74.26, 19.54]);
    expect(doc.taxBasis).toBe(670);
    expect(doc.grandTotal).toBe(763.8);
  });
});

describe("XML", () => {
  test("XRechnung without Leitweg-ID: invoice number as buyer reference, email addresses", () => {
    const xml = new XRechnungProfile().generateXml(invoice());
    expect(xml).toContain("<cbc:BuyerReference>RE-1</cbc:BuyerReference>");
    expect(xml).toContain(`<cbc:EndpointID schemeID="EM">rechnung@example.com</cbc:EndpointID>`);
    expect(xml).toContain(`<cbc:EndpointID schemeID="EM">buchhaltung@example.org</cbc:EndpointID>`);
    expect(xml).toContain("<cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>");
    expect(xml).toContain("<cbc:ID>DE02120300000000202051</cbc:ID>");
    expect(xml).toContain("<cbc:Telephone>+49 30 1234567</cbc:Telephone>");
  });

  test("ZUGFeRD: payment means, due date and terms after the VAT breakdown", () => {
    const xml = new FacturxZugferdProfile().generateXml(
      invoice({ payment_terms: "14 Tage netto" }),
    );
    expect(xml).toContain("<ram:IBANID>DE02120300000000202051</ram:IBANID>");
    expect(xml).toContain(`<udt:DateTimeString format="102">20261116</udt:DateTimeString>`);
    expect(xml.indexOf("<ram:ApplicableTradeTax>\n        <ram:CalculatedAmount>")).toBeLessThan(
      xml.indexOf("<ram:SpecifiedTradePaymentTerms>"),
    );
  });
  test("not subject to VAT: no VAT IDs, the Steuernummer identifies the seller", () => {
    const data = invoice({
      tax_total: 0,
      total: 100,
      items: [line({ tax_rate: 0, tax_amount: 0, tax_category_code: "O" })],
    });
    data.customer.country = "CH";
    const ubl = new XRechnungProfile().generateXml(data);
    expect(ubl).not.toContain("DE123456789");
    expect(ubl).not.toContain("DE987654321");
    expect(ubl).toContain(
      "<cac:PartyIdentification><cbc:ID>12/345/67890</cbc:ID></cac:PartyIdentification>",
    );
    // XRechnung wants a 0 rate in the breakdown (BR-DE-14), the line has none (BR-O-05).
    expect(ubl).toMatch(
      /<cac:TaxSubtotal>[\s\S]*<cbc:ID>O<\/cbc:ID>\s*<cbc:Percent>0<\/cbc:Percent>/,
    );
    expect(ubl).not.toMatch(/<cac:ClassifiedTaxCategory>\s*<cbc:ID>O<\/cbc:ID>\s*<cbc:Percent>/);
    const cii = new FacturxZugferdProfile().generateXml(data);
    expect(cii).not.toContain('schemeID="VA"');
    expect(cii).toContain('<ram:ID schemeID="FC">12/345/67890</ram:ID>');
  });

  const period = { start: "2026-10-01", end: "2026-10-31" };

  test("XRechnung: service date as Delivery (BT-72), period as InvoicePeriod (BG-14)", () => {
    const xml = new XRechnungProfile().generateXml(
      invoice({ service_date: "2026-10-31", service_period: period }),
    );
    expect(xml).toContain(
      "<cac:Delivery>\n    <cbc:ActualDeliveryDate>2026-10-31</cbc:ActualDeliveryDate>\n  </cac:Delivery>",
    );
    expect(xml).toContain(
      "<cac:InvoicePeriod>\n    <cbc:StartDate>2026-10-01</cbc:StartDate>\n    <cbc:EndDate>2026-10-31</cbc:EndDate>\n  </cac:InvoicePeriod>",
    );
    // UBL 2.1 element order.
    const at = (tag: string) => xml.indexOf(tag);
    expect(at("<cbc:BuyerReference>")).toBeLessThan(at("<cac:InvoicePeriod>"));
    expect(at("<cac:InvoicePeriod>")).toBeLessThan(at("<cac:AccountingSupplierParty>"));
    expect(at("</cac:AccountingCustomerParty>")).toBeLessThan(at("<cac:Delivery>"));
    expect(at("<cac:Delivery>")).toBeLessThan(at("<cac:PaymentMeans>"));
  });

  test("XRechnung credit note: the period comes before the invoice reference", () => {
    const xml = new XRechnungProfile().generateXml(
      invoice({
        type: "credit_note",
        service_period: period,
        preceding_invoice: { number: "RE-0", issue_date: "2026-10-31" },
      }),
    );
    expect(xml.indexOf("<cac:InvoicePeriod>")).toBeLessThan(xml.indexOf("<cac:BillingReference>"));
    expect(xml).not.toContain("<cac:Delivery>");
  });

  test("ZUGFeRD: service date as delivery event, period after the VAT breakdown", () => {
    const xml = new FacturxZugferdProfile().generateXml(
      invoice({
        service_date: "2026-10-31",
        service_period: period,
        payment_terms: "14 Tage netto",
        discount_amount: 10,
        tax_total: 17.1,
        total: 107.1,
      }),
    );
    expect(xml).toContain(
      `<ram:ActualDeliverySupplyChainEvent>\n        <ram:OccurrenceDateTime><udt:DateTimeString format="102">20261031</udt:DateTimeString></ram:OccurrenceDateTime>`,
    );
    expect(xml).toContain(
      `<ram:StartDateTime><udt:DateTimeString format="102">20261001</udt:DateTimeString></ram:StartDateTime>`,
    );
    expect(xml).toContain(
      `<ram:EndDateTime><udt:DateTimeString format="102">20261031</udt:DateTimeString></ram:EndDateTime>`,
    );
    expect(xml).not.toContain("<ram:ApplicableHeaderTradeDelivery />");
    // CII D16B element order.
    const at = (tag: string) => xml.indexOf(tag);
    expect(at("</ram:ApplicableHeaderTradeAgreement>")).toBeLessThan(
      at("<ram:ApplicableHeaderTradeDelivery>"),
    );
    expect(at("</ram:ApplicableHeaderTradeDelivery>")).toBeLessThan(
      at("<ram:ApplicableHeaderTradeSettlement>"),
    );
    expect(xml.lastIndexOf("</ram:ApplicableTradeTax>")).toBeLessThan(
      at("<ram:BillingSpecifiedPeriod>"),
    );
    expect(at("<ram:BillingSpecifiedPeriod>")).toBeLessThan(
      at("<ram:SpecifiedTradeAllowanceCharge>"),
    );
    expect(at("<ram:SpecifiedTradeAllowanceCharge>")).toBeLessThan(
      at("<ram:SpecifiedTradePaymentTerms>"),
    );
  });

  test("ZUGFeRD without a service date keeps the empty delivery element", () => {
    const xml = new FacturxZugferdProfile().generateXml(invoice());
    expect(xml).toContain("<ram:ApplicableHeaderTradeDelivery />");
    expect(xml).not.toContain("<ram:BillingSpecifiedPeriod>");
  });

  test("PEPPOL BIS: the same UBL elements, in schema order", () => {
    const xml = new UblPeppolProfile().generateXml(
      invoice({ service_date: "2026-10-31", service_period: period }),
    );
    const at = (tag: string) => xml.indexOf(tag);
    expect(at("<cbc:DocumentCurrencyCode>")).toBeLessThan(at("<cac:InvoicePeriod>"));
    expect(at("<cac:InvoicePeriod>")).toBeLessThan(at("<cac:AccountingSupplierParty>"));
    expect(at("</cac:AccountingCustomerParty>")).toBeLessThan(at("<cac:Delivery>"));
    expect(at("<cac:Delivery>")).toBeLessThan(at("<cac:TaxTotal>"));
    expect(xml).toContain("<cbc:ActualDeliveryDate>2026-10-31</cbc:ActualDeliveryDate>");
  });

  // A credit note for 10 x 100 at 20 % with 10 % off: stored with negative
  // lines, discount and totals.
  const discountedCredit = () =>
    invoice({
      type: "credit_note",
      subtotal: -1000,
      discount_amount: -100,
      tax_total: -180,
      total: -1080,
      items: [
        line({
          quantity: 10,
          unit_price: -100,
          line_total: -1000,
          tax_rate: 20,
          tax_amount: -200,
        }),
      ],
      tax_breakdown: [
        {
          tax_name: "VAT",
          tax_rate: 20,
          category_code: "S",
          taxable_amount: -900,
          tax_amount: -180,
        },
      ],
    });

  test("PEPPOL BIS credit note keeps its discount, so the totals add up", () => {
    const xml = new UblPeppolProfile().generateXml(discountedCredit());
    expect(xml).toContain('<cbc:Amount currencyID="EUR">-100.00</cbc:Amount>');
    expect(xml).toContain(
      '<cbc:LineExtensionAmount currencyID="EUR">-1000.00</cbc:LineExtensionAmount>',
    );
    expect(xml).toContain(
      '<cbc:TaxExclusiveAmount currencyID="EUR">-900.00</cbc:TaxExclusiveAmount>',
    );
    expect(xml).toContain(
      '<cbc:AllowanceTotalAmount currencyID="EUR">-100.00</cbc:AllowanceTotalAmount>',
    );
  });

  test("FatturaPA credit note keeps its discount", () => {
    const xml = new FatturaPaProfile().generateXml(discountedCredit());
    expect(xml).toContain("<Importo>-100.00</Importo>");
    expect(xml).toContain("<ImportoTotaleDocumento>-1080.00</ImportoTotaleDocumento>");
  });

  test("PEPPOL BIS and FatturaPA without a discount have no discount element", () => {
    expect(new UblPeppolProfile().generateXml(invoice())).not.toContain("<cac:AllowanceCharge>");
    expect(new FatturaPaProfile().generateXml(invoice())).not.toContain("<ScontoMaggiorazione>");
  });
});

describe("validator", () => {
  test("XRechnung needs phone, email, postcode and city", () => {
    const data = invoice();
    data.supplier.phone = null;
    data.customer.postal_code = null;
    const codes = validateEinvoice(data, "xrechnung-ubl").map((i) => i.code);
    expect(codes).toContain("xr_seller_phone");
    expect(codes).toContain("xr_buyer_city_postcode");
    expect(validateEinvoice(data, "zugferd").map((i) => i.code)).not.toContain("xr_seller_phone");
  });

  test("totals stored before the discount fix are flagged", () => {
    const data = invoice({
      subtotal: 100,
      discount_amount: 10,
      tax_total: 19, // VAT on the undiscounted amount
      total: 109,
    });
    expect(validateEinvoice(data).map((i) => i.code)).toContain("en16931_totals");
  });

  test("a seller without USt-IdNr and Steuernummer is an error", () => {
    const data = invoice();
    data.supplier.tax_id = null;
    data.supplier.tax_number = null;
    expect(validateEinvoice(data).map((i) => i.code)).toContain("seller_tax_registration");
  });
  test("category O stands alone and needs a Steuernummer", () => {
    const data = invoice({
      subtotal: 200,
      tax_total: 19,
      total: 219,
      items: [line({}), line({ id: "o", tax_rate: 0, tax_amount: 0, tax_category_code: "O" })],
    });
    data.supplier.tax_number = null;
    const codes = validateEinvoice(data).map((i) => i.code);
    expect(codes).toContain("not_subject_mixed");
    expect(codes).toContain("not_subject_tax_number");
  });

  test("an intra-community supply needs a service date and both VAT IDs", () => {
    const supply = {
      tax_total: 0,
      total: 100,
      items: [line({ tax_rate: 0, tax_amount: 0, tax_category_code: "K" })],
    };
    expect(validateEinvoice(invoice(supply)).map((i) => i.code)).toContain(
      "intra_community_delivery",
    );
    const dated = invoice({ ...supply, service_date: "2026-10-30" });
    expect(validateEinvoice(dated).map((i) => i.code)).not.toContain("intra_community_delivery");
    expect(validateEinvoice(dated).map((i) => i.code)).not.toContain("intra_community_vat_ids");
    dated.customer.tax_id = null;
    expect(validateEinvoice(dated).map((i) => i.code)).toContain("intra_community_vat_ids");
  });

  test("an intra-community supply sends the customer's address as the deliver-to address", () => {
    const data = invoice({
      tax_total: 0,
      total: 100,
      service_date: "2026-10-30",
      items: [line({ tax_rate: 0, tax_amount: 0, tax_category_code: "K" })],
    });
    data.customer = { ...data.customer, country: "AT", city: "Wien", postal_code: "1010" };
    const ubl = new XRechnungProfile().generateXml(data);
    expect(ubl).toMatch(
      /<cac:Delivery>\s*<cbc:ActualDeliveryDate>2026-10-30<\/cbc:ActualDeliveryDate>\s*<cac:DeliveryLocation>\s*<cac:Address>[\s\S]*<cbc:CityName>Wien<\/cbc:CityName>\s*<cbc:PostalZone>1010<\/cbc:PostalZone>\s*<cac:Country><cbc:IdentificationCode>AT<\/cbc:IdentificationCode>/,
    );
    const cii = new FacturxZugferdProfile().generateXml(data);
    expect(cii).toMatch(
      /<ram:ShipToTradeParty>[\s\S]*<ram:CountryID>AT<\/ram:CountryID>[\s\S]*<\/ram:ShipToTradeParty>\s*<ram:ActualDeliverySupplyChainEvent>/,
    );
    // Without category K nothing but the date goes in the delivery group.
    const plain = invoice({ service_date: "2026-10-30" });
    expect(new XRechnungProfile().generateXml(plain)).not.toContain("<cac:DeliveryLocation>");
    expect(new FacturxZugferdProfile().generateXml(plain)).not.toContain("<ram:ShipToTradeParty>");
  });
});

describe("hybrid PDF", () => {
  test("discount row: minus on an invoice, plus on a credit note, never two signs", () => {
    const invoiceRow = discountText(100, "EUR", "de-DE");
    const creditRow = discountText(-100, "EUR", "de-DE");
    expect(invoiceRow.startsWith("- ")).toBe(true);
    expect(creditRow.startsWith("+ ")).toBe(true);
    expect(creditRow.slice(2)).toBe(invoiceRow.slice(2));
    expect(creditRow).not.toMatch(/[-\u2212]/);
  });

  test("is PDF/A-3 with Factur-X metadata, an embedded font and the XML attached", async () => {
    const data = invoice();
    const xml = new FacturxZugferdProfile().generateXml(data);
    const { pdfBytes } = await buildEinvoicePdf({ data, facturXml: xml });
    const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
    const catalog = pdf.catalog;

    const metadata = catalog.lookup(PDFName.of("Metadata")) as PDFRawStream;
    const xmp = new TextDecoder().decode(metadata.contents);
    expect(xmp).toContain("<pdfaid:part>3</pdfaid:part>");
    expect(xmp).toContain("<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>");
    expect(xmp).toContain("<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>");

    const intents = catalog.lookup(PDFName.of("OutputIntents"), PDFArray);
    expect(intents.size()).toBe(1);
    const af = catalog.lookup(PDFName.of("AF"), PDFArray);
    const spec = af.lookup(0, PDFDict);
    expect(spec.get(PDFName.of("AFRelationship"))?.toString()).toBe("/Alternative");
    expect(pdf.context.trailerInfo.ID).toBeTruthy();

    // The font is embedded (no standard 14 font reference left).
    const raw = new TextDecoder("latin1").decode(pdfBytes);
    expect(raw).not.toContain("/Helvetica");
  });

  test("renders structured seller address once when free-text address is also set, and falls back otherwise", async () => {
    const both = invoice();
    both.supplier = {
      ...both.supplier,
      address: "Example Str. 1\n12345 Berlin",
      street: "Example Str. 1",
      postal_code: "12345",
      city: "Berlin",
      country: "DE",
    };
    const { pdfBytes: bothPdf } = await buildEinvoicePdf({
      data: both,
      facturXml: new FacturxZugferdProfile().generateXml(both),
    });
    const bothRuns = await pdfTextRuns(bothPdf);
    expect(bothRuns.filter((t) => t === "Example Str. 1")).toEqual(["Example Str. 1"]);
    expect(bothRuns.filter((t) => t === "12345 Berlin")).toEqual(["12345 Berlin"]);

    const fallback = invoice();
    fallback.supplier = {
      ...fallback.supplier,
      address: "Example Str. 1\r\n12345 Berlin",
      street: null,
      postal_code: null,
      city: null,
      country: "DE",
    };
    const { pdfBytes: fallbackPdf } = await buildEinvoicePdf({
      data: fallback,
      facturXml: new FacturxZugferdProfile().generateXml(fallback),
    });
    const fallbackRuns = await pdfTextRuns(fallbackPdf);
    expect(fallbackRuns).toContain("Example Str. 1");
    expect(fallbackRuns).toContain("12345 Berlin");
    expect(fallbackRuns).toContain("DE");
  });
});

function inflateStream(stream: PDFRawStream): string {
  const filter = stream.dict.lookup(PDFName.of("Filter"));
  const bytes =
    filter === PDFName.of("FlateDecode") ? inflateSync(stream.contents) : stream.contents;
  return new TextDecoder("latin1").decode(bytes);
}

/** Decodes every `Tj` text run on page 1 using the embedded font's ToUnicode CMap. */
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
