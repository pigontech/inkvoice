import type { XmlProfile } from "../base-profile";
import {
  amt,
  cleanIban,
  decimal,
  type En16931VatGroup,
  esc,
  percent,
  prepareEn16931,
} from "../en16931";
import type { XmlInvoiceData } from "../types";

// XRechnung 3.0 (UBL 2.1), the German CIUS of EN 16931. Element order follows
// the UBL 2.1 schema; the business rules (BR-DE-*) are checked by the KoSIT
// validator with the XRechnung configuration.

/** CustomizationID (BT-24) of XRechnung 3.0. */
export const XRECHNUNG_3_0_ID =
  "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";

const CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
const CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";

export class XRechnungProfile implements XmlProfile {
  getProfileId(): string {
    return "xrechnung-ubl";
  }
  getProfileName(): string {
    return "XRechnung 3.0 (UBL 2.1)";
  }
  getMimeType(): string {
    return "application/xml";
  }

  generateXml(data: XmlInvoiceData): string {
    const doc = prepareEn16931(data);
    const credit = doc.credit;
    const root = credit ? "CreditNote" : "Invoice";
    const cur = esc(data.currency);
    const money = (tag: string, n: number) =>
      `<cbc:${tag} currencyID="${cur}">${amt(n)}</cbc:${tag}>`;
    const s = data.supplier;
    const c = data.customer;
    const L: string[] = [];

    L.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    L.push(`<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2"`);
    L.push(`  xmlns:cac="${CAC}"`);
    L.push(`  xmlns:cbc="${CBC}">`);
    L.push(`  <cbc:CustomizationID>${XRECHNUNG_3_0_ID}</cbc:CustomizationID>`);
    L.push(`  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>`);
    L.push(`  <cbc:ID>${esc(data.invoice_number)}</cbc:ID>`);
    L.push(`  <cbc:IssueDate>${esc(data.issue_date)}</cbc:IssueDate>`);
    // UBL 2.1 CreditNote has no DueDate; its due date goes in PaymentMeans.
    if (!credit && data.due_date) L.push(`  <cbc:DueDate>${esc(data.due_date)}</cbc:DueDate>`);
    L.push(
      credit
        ? `  <cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>`
        : `  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>`,
    );
    for (const note of doc.notes) L.push(`  <cbc:Note>${esc(note)}</cbc:Note>`);
    L.push(`  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>`);
    // BT-10 is mandatory in XRechnung (BR-DE-15). Public buyers give their
    // Leitweg-ID; without one the invoice number is the reference.
    L.push(
      `  <cbc:BuyerReference>${esc(c.leitweg_id || data.invoice_number)}</cbc:BuyerReference>`,
    );
    // Service period (BG-14).
    if (data.service_period) {
      L.push(`  <cac:InvoicePeriod>`);
      L.push(`    <cbc:StartDate>${esc(data.service_period.start)}</cbc:StartDate>`);
      L.push(`    <cbc:EndDate>${esc(data.service_period.end)}</cbc:EndDate>`);
      L.push(`  </cac:InvoicePeriod>`);
    }
    if (data.preceding_invoice) {
      L.push(`  <cac:BillingReference>`);
      L.push(`    <cac:InvoiceDocumentReference>`);
      L.push(`      <cbc:ID>${esc(data.preceding_invoice.number)}</cbc:ID>`);
      if (data.preceding_invoice.issue_date) {
        L.push(`      <cbc:IssueDate>${esc(data.preceding_invoice.issue_date)}</cbc:IssueDate>`);
      }
      L.push(`    </cac:InvoiceDocumentReference>`);
      L.push(`  </cac:BillingReference>`);
    }

    // --- Seller (BG-4) ---
    L.push(`  <cac:AccountingSupplierParty>`);
    L.push(`    <cac:Party>`);
    if (s.peppol_endpoint_id) {
      L.push(
        `      <cbc:EndpointID schemeID="${esc(s.peppol_scheme_id || "0208")}">${esc(s.peppol_endpoint_id)}</cbc:EndpointID>`,
      );
    } else if (s.email) {
      L.push(`      <cbc:EndpointID schemeID="EM">${esc(s.email)}</cbc:EndpointID>`);
    }
    // BR-CO-26: without a VAT ID the tax number identifies the seller (BT-29).
    if (!doc.sellerVatId && s.tax_number) {
      L.push(
        `      <cac:PartyIdentification><cbc:ID>${esc(s.tax_number)}</cbc:ID></cac:PartyIdentification>`,
      );
    }
    L.push(`      <cac:PartyName><cbc:Name>${esc(s.name)}</cbc:Name></cac:PartyName>`);
    L.push(`      <cac:PostalAddress>`);
    if (s.street || s.address) {
      L.push(`        <cbc:StreetName>${esc(s.street || s.address)}</cbc:StreetName>`);
    }
    if (s.city) L.push(`        <cbc:CityName>${esc(s.city)}</cbc:CityName>`);
    if (s.postal_code) L.push(`        <cbc:PostalZone>${esc(s.postal_code)}</cbc:PostalZone>`);
    L.push(
      `        <cac:Country><cbc:IdentificationCode>${esc(s.country)}</cbc:IdentificationCode></cac:Country>`,
    );
    L.push(`      </cac:PostalAddress>`);
    if (doc.sellerVatId) L.push(...taxScheme(doc.sellerVatId, "VAT", "      "));
    if (s.tax_number) L.push(...taxScheme(s.tax_number, "FC", "      "));
    L.push(
      `      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(s.name)}</cbc:RegistrationName></cac:PartyLegalEntity>`,
    );
    L.push(`      <cac:Contact>`);
    L.push(`        <cbc:Name>${esc(s.name)}</cbc:Name>`);
    if (s.phone) L.push(`        <cbc:Telephone>${esc(s.phone)}</cbc:Telephone>`);
    if (s.email) L.push(`        <cbc:ElectronicMail>${esc(s.email)}</cbc:ElectronicMail>`);
    L.push(`      </cac:Contact>`);
    L.push(`    </cac:Party>`);
    L.push(`  </cac:AccountingSupplierParty>`);

    // --- Buyer (BG-7) ---
    L.push(`  <cac:AccountingCustomerParty>`);
    L.push(`    <cac:Party>`);
    if (c.leitweg_id) {
      L.push(`      <cbc:EndpointID schemeID="0204">${esc(c.leitweg_id)}</cbc:EndpointID>`);
    } else if (c.einvoice_receiver_id) {
      L.push(
        `      <cbc:EndpointID schemeID="${esc(c.einvoice_receiver_scheme || "0088")}">${esc(c.einvoice_receiver_id)}</cbc:EndpointID>`,
      );
    } else if (c.email) {
      L.push(`      <cbc:EndpointID schemeID="EM">${esc(c.email)}</cbc:EndpointID>`);
    }
    L.push(`      <cac:PartyName><cbc:Name>${esc(c.name)}</cbc:Name></cac:PartyName>`);
    L.push(`      <cac:PostalAddress>`);
    if (c.address_line1) L.push(`        <cbc:StreetName>${esc(c.address_line1)}</cbc:StreetName>`);
    if (c.address_line2) {
      L.push(
        `        <cbc:AdditionalStreetName>${esc(c.address_line2)}</cbc:AdditionalStreetName>`,
      );
    }
    if (c.city) L.push(`        <cbc:CityName>${esc(c.city)}</cbc:CityName>`);
    if (c.postal_code) L.push(`        <cbc:PostalZone>${esc(c.postal_code)}</cbc:PostalZone>`);
    if (c.state) L.push(`        <cbc:CountrySubentity>${esc(c.state)}</cbc:CountrySubentity>`);
    L.push(
      `        <cac:Country><cbc:IdentificationCode>${esc((c.country || "").toUpperCase())}</cbc:IdentificationCode></cac:Country>`,
    );
    L.push(`      </cac:PostalAddress>`);
    if (doc.buyerVatId) L.push(...taxScheme(doc.buyerVatId, "VAT", "      "));
    L.push(
      `      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(c.name)}</cbc:RegistrationName></cac:PartyLegalEntity>`,
    );
    if (c.email || c.phone) {
      L.push(`      <cac:Contact>`);
      if (c.phone) L.push(`        <cbc:Telephone>${esc(c.phone)}</cbc:Telephone>`);
      if (c.email) L.push(`        <cbc:ElectronicMail>${esc(c.email)}</cbc:ElectronicMail>`);
      L.push(`      </cac:Contact>`);
    }
    L.push(`    </cac:Party>`);
    L.push(`  </cac:AccountingCustomerParty>`);

    // --- Delivery (BG-13): the date of supply (BT-72) ---
    if (data.service_date) {
      L.push(`  <cac:Delivery>`);
      L.push(`    <cbc:ActualDeliveryDate>${esc(data.service_date)}</cbc:ActualDeliveryDate>`);
      L.push(`  </cac:Delivery>`);
    }

    // --- Payment instructions (BG-16, mandatory in XRechnung: BR-DE-1) ---
    const iban = cleanIban(s.iban);
    L.push(`  <cac:PaymentMeans>`);
    // 58 = SEPA credit transfer; 1 = not defined (no IBAN in the settings).
    L.push(`    <cbc:PaymentMeansCode>${iban ? "58" : "1"}</cbc:PaymentMeansCode>`);
    if (credit && data.due_date) {
      L.push(`    <cbc:PaymentDueDate>${esc(data.due_date)}</cbc:PaymentDueDate>`);
    }
    L.push(`    <cbc:PaymentID>${esc(data.invoice_number)}</cbc:PaymentID>`);
    if (iban) {
      L.push(`    <cac:PayeeFinancialAccount>`);
      L.push(`      <cbc:ID>${esc(iban)}</cbc:ID>`);
      L.push(`      <cbc:Name>${esc(s.account_holder || s.name)}</cbc:Name>`);
      if (s.bic) {
        L.push(
          `      <cac:FinancialInstitutionBranch><cbc:ID>${esc(s.bic.replace(/\s+/g, ""))}</cbc:ID></cac:FinancialInstitutionBranch>`,
        );
      }
      L.push(`    </cac:PayeeFinancialAccount>`);
    }
    L.push(`  </cac:PaymentMeans>`);
    if (data.payment_terms) {
      L.push(
        `  <cac:PaymentTerms><cbc:Note>${esc(data.payment_terms)}</cbc:Note></cac:PaymentTerms>`,
      );
    }

    // --- Document level allowances (BG-20), one per VAT group ---
    for (const g of doc.groups) {
      if (!g.allowance) continue;
      const charge = g.allowance < 0;
      L.push(`  <cac:AllowanceCharge>`);
      L.push(`    <cbc:ChargeIndicator>${charge ? "true" : "false"}</cbc:ChargeIndicator>`);
      L.push(
        `    <cbc:AllowanceChargeReason>${charge ? "Zuschlag" : "Rabatt"}</cbc:AllowanceChargeReason>`,
      );
      L.push(`    ${money("Amount", Math.abs(g.allowance))}`);
      L.push(...taxCategory(g, "TaxCategory", "    ", false));
      L.push(`  </cac:AllowanceCharge>`);
    }

    // --- VAT breakdown (BG-23) ---
    L.push(`  <cac:TaxTotal>`);
    L.push(`    ${money("TaxAmount", doc.taxTotal)}`);
    for (const g of doc.groups) {
      L.push(`    <cac:TaxSubtotal>`);
      L.push(`      ${money("TaxableAmount", g.taxable)}`);
      L.push(`      ${money("TaxAmount", g.tax)}`);
      L.push(...taxCategory(g, "TaxCategory", "      ", true));
      L.push(`    </cac:TaxSubtotal>`);
    }
    L.push(`  </cac:TaxTotal>`);

    // --- Document totals (BG-22) ---
    L.push(`  <cac:LegalMonetaryTotal>`);
    L.push(`    ${money("LineExtensionAmount", doc.lineTotal)}`);
    L.push(`    ${money("TaxExclusiveAmount", doc.taxBasis)}`);
    L.push(`    ${money("TaxInclusiveAmount", doc.grandTotal)}`);
    if (doc.allowanceTotal) L.push(`    ${money("AllowanceTotalAmount", doc.allowanceTotal)}`);
    if (doc.chargeTotal) L.push(`    ${money("ChargeTotalAmount", doc.chargeTotal)}`);
    L.push(`    ${money("PayableAmount", doc.grandTotal)}`);
    L.push(`  </cac:LegalMonetaryTotal>`);

    // --- Lines (BG-25) ---
    const lineTag = credit ? "CreditNoteLine" : "InvoiceLine";
    const qtyTag = credit ? "CreditedQuantity" : "InvoicedQuantity";
    for (const line of doc.lines) {
      L.push(`  <cac:${lineTag}>`);
      L.push(`    <cbc:ID>${line.index}</cbc:ID>`);
      L.push(
        `    <cbc:${qtyTag} unitCode="${mapUnitCode(line.unit)}">${decimal(line.quantity)}</cbc:${qtyTag}>`,
      );
      L.push(`    ${money("LineExtensionAmount", line.net)}`);
      L.push(`    <cac:Item>`);
      L.push(`      <cbc:Name>${esc(line.name)}</cbc:Name>`);
      L.push(`      <cac:ClassifiedTaxCategory>`);
      L.push(`        <cbc:ID>${line.category}</cbc:ID>`);
      if (line.category !== "O") L.push(`        <cbc:Percent>${percent(line.rate)}</cbc:Percent>`);
      L.push(`        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>`);
      L.push(`      </cac:ClassifiedTaxCategory>`);
      L.push(`    </cac:Item>`);
      L.push(`    <cac:Price>`);
      L.push(
        `      <cbc:PriceAmount currencyID="${cur}">${decimal(line.price, 2)}</cbc:PriceAmount>`,
      );
      L.push(`    </cac:Price>`);
      L.push(`  </cac:${lineTag}>`);
    }

    L.push(`</${root}>`);
    return L.join("\n");
  }
}

function taxScheme(companyId: string, scheme: string, indent: string): string[] {
  return [
    `${indent}<cac:PartyTaxScheme>`,
    `${indent}  <cbc:CompanyID>${esc(companyId)}</cbc:CompanyID>`,
    `${indent}  <cac:TaxScheme><cbc:ID>${scheme}</cbc:ID></cac:TaxScheme>`,
    `${indent}</cac:PartyTaxScheme>`,
  ];
}

/** cac:TaxCategory for a VAT group; the breakdown also carries the exemption reason. */
function taxCategory(
  g: En16931VatGroup,
  tag: string,
  indent: string,
  withReason: boolean,
): string[] {
  const out = [`${indent}<cac:${tag}>`, `${indent}  <cbc:ID>${g.category}</cbc:ID>`];
  // XRechnung wants the rate in the VAT breakdown even for category O
  // (BR-DE-14), while O allowances and charges carry none (BR-O-06, BR-O-07).
  if (g.category !== "O" || withReason) {
    out.push(`${indent}  <cbc:Percent>${percent(g.rate)}</cbc:Percent>`);
  }
  if (withReason && g.exemptionCode) {
    out.push(
      `${indent}  <cbc:TaxExemptionReasonCode>${g.exemptionCode}</cbc:TaxExemptionReasonCode>`,
    );
  }
  if (withReason && g.exemptionReason) {
    out.push(
      `${indent}  <cbc:TaxExemptionReason>${esc(g.exemptionReason)}</cbc:TaxExemptionReason>`,
    );
  }
  out.push(
    `${indent}  <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>`,
    `${indent}</cac:${tag}>`,
  );
  return out;
}

function mapUnitCode(unit: string): string {
  const map: Record<string, string> = {
    piece: "H87",
    hour: "HUR",
    day: "DAY",
    kg: "KGM",
    meter: "MTR",
    lump_sum: "LS",
    month: "MON",
  };
  return map[unit] || "C62";
}
