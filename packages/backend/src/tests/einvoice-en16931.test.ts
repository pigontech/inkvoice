import { describe, expect, test } from "bun:test";
import { validateEinvoice } from "../services/einvoice-validator.service";
import { payeeAccount, vatCategory, vatGroups } from "../xml/en16931";
import { FacturxZugferdProfile } from "../xml/profiles/facturx-zugferd";
import { XRechnungProfile } from "../xml/profiles/xrechnung";
import type { XmlInvoiceData } from "../xml/types";

// Regression tests for EN 16931 / XRechnung conformance. Each expectation
// mirrors a rule the KoSIT validator (XRechnung 3.0 configuration) enforces.

type Line = {
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  tax_category_code: string;
  unit?: string;
};

function invoice(
  lines: Line[],
  overrides: Omit<Partial<XmlInvoiceData>, "supplier" | "customer"> & {
    supplier?: Partial<XmlInvoiceData["supplier"]>;
    customer?: Partial<XmlInvoiceData["customer"]>;
    taxBase?: "discounted" | "undiscounted";
  } = {},
): XmlInvoiceData {
  const { supplier, customer, taxBase = "discounted", ...rest } = overrides;
  const items = lines.map((l, i) => {
    const line_total = Math.round(l.quantity * l.unit_price * 100) / 100;
    return {
      id: String(i + 1),
      unit: "piece",
      ...l,
      line_total,
      tax_amount: Math.round(line_total * l.tax_rate) / 100,
    };
  });
  const subtotal = items.reduce((s, i) => s + i.line_total, 0);
  const discount_amount = rest.discount_amount ?? 0;
  const factor = taxBase === "discounted" && subtotal > 0 ? 1 - discount_amount / subtotal : 1;
  const rates = [...new Set(items.map((i) => `${i.tax_category_code}|${i.tax_rate}`))];
  const tax_breakdown = rates.map((key) => {
    const [category_code, rate] = key.split("|");
    const net = items
      .filter((i) => `${i.tax_category_code}|${i.tax_rate}` === key)
      .reduce((s, i) => s + i.line_total, 0);
    const taxable = Math.round(net * factor * 100) / 100;
    return {
      tax_name: `USt ${rate}%`,
      tax_rate: Number(rate),
      category_code,
      taxable_amount: taxable,
      tax_amount: Math.round(taxable * Number(rate)) / 100,
    };
  });
  const tax_total = tax_breakdown.reduce((s, t) => s + t.tax_amount, 0);
  return {
    invoice_number: "RE-2026-0001",
    issue_date: "2026-10-04",
    due_date: "2026-10-18",
    currency: "EUR",
    locale: "de-DE",
    type: "invoice",
    notes: null,
    payment_terms: "Zahlbar innerhalb von 14 Tagen",
    subtotal,
    tax_total,
    discount_amount,
    total: subtotal - discount_amount + tax_total,
    kleinunternehmer: false,
    supplier: {
      name: "Muster GmbH",
      email: "rechnung@muster.de",
      phone: "+49 30 1234567",
      address: null,
      street: "Hauptstraße 1",
      city: "Berlin",
      postal_code: "10115",
      country: "DE",
      tax_id: "DE123456789",
      tax_number: "12/345/67890",
      bank_details: "IBAN: DE89 3704 0044 0532 0130 00\nBIC: COBADEFFXXX",
      iban: null,
      bic: null,
      account_holder: null,
      contact_name: null,
      peppol_endpoint_id: null,
      peppol_scheme_id: null,
      ...supplier,
    },
    customer: {
      name: "Kunde AG",
      email: "ap@kunde.de",
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
      ...customer,
    },
    items,
    tax_breakdown,
    ...rest,
  };
}

const standard = (): XmlInvoiceData =>
  invoice([
    {
      description: "Beratung",
      quantity: 10,
      unit_price: 100,
      tax_rate: 19,
      tax_category_code: "S",
    },
  ]);

/** Asserts that every fragment occurs in `xml`, in the given order. */
function expectInOrder(xml: string, fragments: string[]): void {
  let from = 0;
  for (const fragment of fragments) {
    const at = xml.indexOf(fragment, from);
    expect(at, `"${fragment}" missing or out of order`).toBeGreaterThanOrEqual(0);
    from = at + fragment.length;
  }
}

function section(xml: string, open: string, close: string): string {
  const start = xml.indexOf(open);
  expect(start, `"${open}" missing`).toBeGreaterThanOrEqual(0);
  return xml.slice(start, xml.indexOf(close, start) + close.length);
}

describe("EN 16931 helpers", () => {
  test("should map the non-EN 16931 reduced-rate code AA to S", () => {
    expect(vatCategory("AA", 7, standard())).toBe("S");
  });

  test("should mark every line exempt (E) for a Kleinunternehmer", () => {
    expect(vatCategory("Z", 0, { ...standard(), kleinunternehmer: true })).toBe("E");
  });

  test("should prefer the structured IBAN/BIC settings over the bank details text", () => {
    const { supplier } = invoice([], {
      supplier: {
        iban: "DE02120300000000202051",
        bic: "BYLADEM1001",
        account_holder: "Max Muster",
      },
    });
    expect(payeeAccount(supplier)).toEqual({
      iban: "DE02120300000000202051",
      bic: "BYLADEM1001",
      holder: "Max Muster",
    });
  });

  test("should fall back to an IBAN and BIC found in the bank details text", () => {
    expect(payeeAccount(standard().supplier)).toEqual({
      iban: "DE89370400440532013000",
      bic: "COBADEFFXXX",
      holder: "Muster GmbH",
    });
  });

  test("should reject an IBAN with a wrong checksum", () => {
    const { supplier } = invoice([], {
      supplier: { bank_details: "IBAN DE88 3704 0044 0532 0130 00" },
    });
    expect(payeeAccount(supplier)).toBeNull();
  });

  test("should split a document discount across VAT groups without losing cents", () => {
    const data = invoice(
      [
        {
          description: "Workshop",
          quantity: 1,
          unit_price: 1500,
          tax_rate: 19,
          tax_category_code: "S",
        },
        {
          description: "Handbuch",
          quantity: 5,
          unit_price: 19.9,
          tax_rate: 7,
          tax_category_code: "AA",
        },
      ],
      { discount_amount: 159.95 },
    );
    const groups = vatGroups(data);
    expect(groups.map((g) => g.category)).toEqual(["S", "S"]);
    expect(groups.reduce((s, g) => s + g.allowance, 0)).toBeCloseTo(159.95, 2);
    for (const g of groups) expect(g.taxable).toBeCloseTo(g.lineNet - g.allowance, 2);
  });
});

describe("XRechnungProfile", () => {
  const profile = new XRechnungProfile();

  test("should use the KoSIT XRechnung 3.0 CustomizationID", () => {
    expect(profile.generateXml(standard())).toContain(
      "<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>",
    );
  });

  test("should emit seller party elements in UBL schema order", () => {
    const seller = section(
      profile.generateXml(standard()),
      "<cac:AccountingSupplierParty>",
      "</cac:AccountingSupplierParty>",
    );
    expectInOrder(seller, [
      '<cbc:EndpointID schemeID="EM">rechnung@muster.de</cbc:EndpointID>',
      "<cac:PartyName>",
      "<cac:PostalAddress>",
      "<cbc:CityName>Berlin</cbc:CityName>",
      "<cbc:PostalZone>10115</cbc:PostalZone>",
      "<cbc:ID>VAT</cbc:ID>",
      "<cbc:ID>FC</cbc:ID>",
      "<cac:PartyLegalEntity>",
      "<cbc:Telephone>+49 30 1234567</cbc:Telephone>",
    ]);
  });

  test("should emit BuyerReference, buyer endpoint and SEPA payment means", () => {
    const xml = profile.generateXml(standard());
    expectInOrder(xml, [
      "<cbc:BuyerReference>RE-2026-0001</cbc:BuyerReference>",
      '<cbc:EndpointID schemeID="EM">ap@kunde.de</cbc:EndpointID>',
      "<cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>",
      "<cbc:ID>DE89370400440532013000</cbc:ID>",
      "<cbc:ID>COBADEFFXXX</cbc:ID>",
      "<cac:PaymentTerms>",
      "<cac:TaxTotal>",
    ]);
  });

  test("should use the Leitweg-ID as BuyerReference for public-sector buyers", () => {
    const xml = profile.generateXml(
      invoice(standard().items.map(toLine), { customer: { leitweg_id: "04011000-12345-34" } }),
    );
    expect(xml).toContain("<cbc:BuyerReference>04011000-12345-34</cbc:BuyerReference>");
    expect(xml).toContain('<cbc:EndpointID schemeID="0204">04011000-12345-34</cbc:EndpointID>');
  });

  test("should emit 7 % VAT as category S, never AA", () => {
    const xml = profile.generateXml(
      invoice([
        { description: "Buch", quantity: 1, unit_price: 20, tax_rate: 7, tax_category_code: "AA" },
      ]),
    );
    expect(xml).not.toContain("<cbc:ID>AA</cbc:ID>");
    expect(xml).toContain("<cbc:ID>S</cbc:ID>\n        <cbc:Percent>7</cbc:Percent>");
  });

  test("should emit a zero rate and exemption reason for Kleinunternehmer", () => {
    const xml = profile.generateXml(
      invoice(
        [
          {
            description: "Webdesign",
            quantity: 1,
            unit_price: 480,
            tax_rate: 0,
            tax_category_code: "Z",
          },
        ],
        {
          kleinunternehmer: true,
        },
      ),
    );
    expectInOrder(section(xml, "<cac:TaxSubtotal>", "</cac:TaxSubtotal>"), [
      "<cbc:ID>E</cbc:ID>",
      "<cbc:Percent>0</cbc:Percent>",
      "<cbc:TaxExemptionReason>Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG</cbc:TaxExemptionReason>",
    ]);
  });

  test("should give each discounted VAT group its own allowance with a tax category", () => {
    const xml = profile.generateXml(
      invoice(
        [
          { description: "A", quantity: 1, unit_price: 100, tax_rate: 19, tax_category_code: "S" },
          { description: "B", quantity: 1, unit_price: 100, tax_rate: 7, tax_category_code: "S" },
        ],
        { discount_amount: 20 },
      ),
    );
    expect(xml.match(/<cac:AllowanceCharge>/g)?.length).toBe(2);
    expect(xml).toContain(
      '<cbc:AllowanceTotalAmount currencyID="EUR">20.00</cbc:AllowanceTotalAmount>',
    );
  });

  test("should not emit a header DueDate on a credit note", () => {
    const xml = profile.generateXml({ ...standard(), type: "credit_note" });
    expect(xml).toContain("<CreditNote ");
    expect(xml).not.toContain("<cbc:DueDate>");
  });

  test("should emit a negatively stored credit note with positive amounts (BR-27)", () => {
    const positive = standard();
    const stored: XmlInvoiceData = {
      ...positive,
      type: "credit_note",
      subtotal: -positive.subtotal,
      tax_total: -positive.tax_total,
      total: -positive.total,
      items: positive.items.map((i) => ({
        ...i,
        unit_price: -i.unit_price,
        line_total: -i.line_total,
        tax_amount: -i.tax_amount,
      })),
      tax_breakdown: positive.tax_breakdown.map((t) => ({
        ...t,
        taxable_amount: -t.taxable_amount,
        tax_amount: -t.tax_amount,
      })),
    };
    for (const xml of [
      profile.generateXml(stored),
      new FacturxZugferdProfile().generateXml(stored),
    ]) {
      expect(xml).not.toMatch(/>-\d/);
      expect(xml).toContain(">1190.00<");
    }
  });

  test("should name the configured contact person as seller contact", () => {
    const withContact = invoice(standard().items.map(toLine), {
      supplier: { contact_name: "Erika Mustermann" },
    });
    expect(profile.generateXml(withContact)).toContain(
      "<cac:Contact>\n        <cbc:Name>Erika Mustermann</cbc:Name>",
    );
    expect(profile.generateXml(standard())).toContain(
      "<cac:Contact>\n        <cbc:Name>Muster GmbH</cbc:Name>",
    );
  });

  test("should fall back to payment means code 1 when no IBAN is configured", () => {
    const xml = profile.generateXml(
      invoice(standard().items.map(toLine), { supplier: { bank_details: null } }),
    );
    expect(xml).toContain("<cbc:PaymentMeansCode>1</cbc:PaymentMeansCode>");
    expect(xml).not.toContain("<cac:PayeeFinancialAccount>");
  });

  test("should map the default unit to a UN/ECE Rec 20 code", () => {
    expect(profile.generateXml(standard())).toContain('<cbc:InvoicedQuantity unitCode="C62">');
  });
});

describe("FacturxZugferdProfile", () => {
  const profile = new FacturxZugferdProfile();

  test("should emit trade address elements in CII schema order", () => {
    const seller = section(
      profile.generateXml(standard()),
      "<ram:SellerTradeParty>",
      "</ram:SellerTradeParty>",
    );
    expectInOrder(seller, [
      "<ram:Name>Muster GmbH</ram:Name>",
      "<ram:DefinedTradeContact>",
      "<ram:CompleteNumber>+49 30 1234567</ram:CompleteNumber>",
      "<ram:PostcodeCode>10115</ram:PostcodeCode>",
      "<ram:LineOne>Hauptstraße 1</ram:LineOne>",
      "<ram:CityName>Berlin</ram:CityName>",
      "<ram:CountryID>DE</ram:CountryID>",
      '<ram:URIID schemeID="EM">rechnung@muster.de</ram:URIID>',
      '<ram:ID schemeID="VA">DE123456789</ram:ID>',
      '<ram:ID schemeID="FC">12/345/67890</ram:ID>',
    ]);
    expect(seller).not.toContain('schemeID="SEID"');
  });

  test("should emit header settlement elements in CII schema order", () => {
    const xml = profile.generateXml(invoice(standard().items.map(toLine), { discount_amount: 50 }));
    expectInOrder(
      section(
        xml,
        "<ram:ApplicableHeaderTradeSettlement>",
        "</ram:ApplicableHeaderTradeSettlement>",
      ),
      [
        "<ram:PaymentReference>",
        "<ram:InvoiceCurrencyCode>",
        "<ram:IBANID>DE89370400440532013000</ram:IBANID>",
        "<ram:ApplicableTradeTax>",
        "<ram:SpecifiedTradeAllowanceCharge>",
        "<ram:SpecifiedTradePaymentTerms>",
        '<udt:DateTimeString format="102">20261018</udt:DateTimeString>',
        "<ram:SpecifiedTradeSettlementHeaderMonetarySummation>",
      ],
    );
  });

  test("should place the exemption reason before the category code", () => {
    const xml = profile.generateXml(
      invoice(
        [
          {
            description: "Webdesign",
            quantity: 1,
            unit_price: 480,
            tax_rate: 0,
            tax_category_code: "Z",
          },
        ],
        {
          kleinunternehmer: true,
        },
      ),
    );
    expectInOrder(
      section(
        xml,
        "<ram:ApplicableTradeTax>\n        <ram:CalculatedAmount>",
        "</ram:ApplicableTradeTax>",
      ),
      [
        "<ram:ExemptionReason>",
        "<ram:BasisAmount>",
        "<ram:CategoryCode>E</ram:CategoryCode>",
        "<ram:RateApplicablePercent>0</ram:RateApplicablePercent>",
      ],
    );
  });

  test("should name the configured contact person and account holder", () => {
    const xml = profile.generateXml(
      invoice(standard().items.map(toLine), {
        supplier: { contact_name: "Erika Mustermann", account_holder: "Muster GmbH Treuhand" },
      }),
    );
    expect(xml).toContain("<ram:PersonName>Erika Mustermann</ram:PersonName>");
    expect(xml).toContain("<ram:AccountName>Muster GmbH Treuhand</ram:AccountName>");
  });

  test("should put the buyer reference first in the header agreement", () => {
    const xml = profile.generateXml(standard());
    expectInOrder(xml, [
      "<ram:BuyerReference>RE-2026-0001</ram:BuyerReference>",
      "<ram:SellerTradeParty>",
    ]);
  });
});

describe("validateEinvoice", () => {
  const codes = (data: XmlInvoiceData, format?: string) =>
    validateEinvoice(data, format).map((i) => `${i.severity}:${i.code}`);

  test("should report no issues for complete invoice data", () => {
    expect(codes(standard(), "xrechnung-ubl")).toEqual([]);
  });

  test("should require the seller VAT ID (BR-CO-26)", () => {
    expect(codes(invoice(standard().items.map(toLine), { supplier: { tax_id: null } }))).toContain(
      "error:seller_vat_id",
    );
  });

  test("should require seller phone only for XRechnung", () => {
    const data = invoice(standard().items.map(toLine), { supplier: { phone: null } });
    expect(codes(data, "xrechnung-ubl")).toContain("error:seller_phone");
    expect(codes(data, "zugferd")).not.toContain("error:seller_phone");
  });

  test("should warn when the bank details contain no valid IBAN", () => {
    expect(
      codes(invoice(standard().items.map(toLine), { supplier: { bank_details: "Sparkasse" } })),
    ).toContain("warning:seller_iban");
  });

  test("should flag VAT calculated on the amount before the document discount", () => {
    const data = invoice(standard().items.map(toLine), {
      discount_amount: 100,
      taxBase: "undiscounted",
    });
    const issue = validateEinvoice(data).find((i) => i.code === "vat_amount");
    expect(issue?.severity).toBe("error");
    expect(issue?.message).toContain("§ 10 UStG");
  });
});

function toLine(item: XmlInvoiceData["items"][number]): Line {
  return {
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    tax_rate: item.tax_rate,
    tax_category_code: item.tax_category_code,
    unit: item.unit,
  };
}
