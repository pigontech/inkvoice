import type { XmlProfile } from "../base-profile";
import {
  amt,
  buyerElectronicAddress,
  buyerReference,
  documentTotals,
  esc,
  forEmission,
  hasPercent,
  payeeAccount,
  sellerContactName,
  sellerElectronicAddress,
  unitCode,
  vatCategory,
  vatGroups,
  vatRate,
} from "../en16931";
import type { XmlInvoiceData } from "../types";

// XRechnung 3.0 (UBL 2.1) — German e-invoicing standard (EN 16931 based).
// Element order follows the UBL 2.1 schema sequences; validated against the
// KoSIT validator with the XRechnung 3.0 configuration.

const XRECHNUNG_CUSTOMIZATION_ID =
  "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";

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

  generateXml(input: XmlInvoiceData): string {
    const data = forEmission(input);
    const isCredit = data.type === "credit_note";
    const rootTag = isCredit ? "CreditNote" : "Invoice";
    const cur = esc(data.currency);
    const groups = vatGroups(data);
    const totals = documentTotals(data, groups);

    const lines: string[] = [];
    lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    lines.push(`<${rootTag} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${rootTag}-2"`);
    lines.push(
      `  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"`,
    );
    lines.push(
      `  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`,
    );

    lines.push(`  <cbc:CustomizationID>${XRECHNUNG_CUSTOMIZATION_ID}</cbc:CustomizationID>`);
    lines.push(`  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>`);
    lines.push(`  <cbc:ID>${esc(data.invoice_number)}</cbc:ID>`);
    lines.push(`  <cbc:IssueDate>${data.issue_date}</cbc:IssueDate>`);
    // A UBL CreditNote has no header DueDate.
    if (data.due_date && !isCredit) {
      lines.push(`  <cbc:DueDate>${data.due_date}</cbc:DueDate>`);
    }
    lines.push(
      isCredit
        ? `  <cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>`
        : `  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>`,
    );
    if (data.notes) {
      lines.push(`  <cbc:Note>${esc(data.notes)}</cbc:Note>`);
    }
    // Required German tax notes ([§19 UStG] Kleinunternehmer, reverse charge).
    if (data.kleinunternehmer) {
      lines.push(`  <cbc:Note>Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</cbc:Note>`);
    }
    if (groups.some((g) => g.category === "AE")) {
      lines.push(
        `  <cbc:Note>Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge).</cbc:Note>`,
      );
    }
    lines.push(`  <cbc:DocumentCurrencyCode>${cur}</cbc:DocumentCurrencyCode>`);
    lines.push(`  <cbc:BuyerReference>${esc(buyerReference(data))}</cbc:BuyerReference>`);

    // --- Seller (BG-4) ---
    const seller = data.supplier;
    lines.push(`  <cac:AccountingSupplierParty>`);
    lines.push(`    <cac:Party>`);
    const sellerEndpoint = sellerElectronicAddress(data);
    if (sellerEndpoint) {
      lines.push(
        `      <cbc:EndpointID schemeID="${esc(sellerEndpoint.scheme)}">${esc(sellerEndpoint.id)}</cbc:EndpointID>`,
      );
    }
    lines.push(`      <cac:PartyName><cbc:Name>${esc(seller.name)}</cbc:Name></cac:PartyName>`);
    pushAddress(lines, {
      street: seller.street || seller.address,
      additional: null,
      city: seller.city,
      postalCode: seller.postal_code,
      subentity: null,
      country: seller.country,
    });
    if (seller.tax_id) pushTaxScheme(lines, seller.tax_id, "VAT");
    // BT-32 seller tax registration (Steuernummer); "FC" per the XRechnung spec.
    if (seller.tax_number) pushTaxScheme(lines, seller.tax_number, "FC");
    lines.push(
      `      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(seller.name)}</cbc:RegistrationName></cac:PartyLegalEntity>`,
    );
    // BG-6 seller contact: XRechnung requires name, phone and email (BR-DE-5..7).
    lines.push(`      <cac:Contact>`);
    lines.push(`        <cbc:Name>${esc(sellerContactName(data))}</cbc:Name>`);
    if (seller.phone) lines.push(`        <cbc:Telephone>${esc(seller.phone)}</cbc:Telephone>`);
    if (seller.email) {
      lines.push(`        <cbc:ElectronicMail>${esc(seller.email)}</cbc:ElectronicMail>`);
    }
    lines.push(`      </cac:Contact>`);
    lines.push(`    </cac:Party>`);
    lines.push(`  </cac:AccountingSupplierParty>`);

    // --- Buyer (BG-7) ---
    const buyer = data.customer;
    lines.push(`  <cac:AccountingCustomerParty>`);
    lines.push(`    <cac:Party>`);
    const buyerEndpoint = buyerElectronicAddress(data);
    if (buyerEndpoint) {
      lines.push(
        `      <cbc:EndpointID schemeID="${esc(buyerEndpoint.scheme)}">${esc(buyerEndpoint.id)}</cbc:EndpointID>`,
      );
    }
    lines.push(`      <cac:PartyName><cbc:Name>${esc(buyer.name)}</cbc:Name></cac:PartyName>`);
    pushAddress(lines, {
      street: buyer.address_line1,
      additional: buyer.address_line2,
      city: buyer.city,
      postalCode: buyer.postal_code,
      subentity: buyer.state,
      country: buyer.country,
    });
    // EN 16931 has no buyer tax number, only the VAT identifier (BT-48).
    if (buyer.tax_id) pushTaxScheme(lines, buyer.tax_id, "VAT");
    lines.push(
      `      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(buyer.name)}</cbc:RegistrationName></cac:PartyLegalEntity>`,
    );
    if (buyer.email) {
      lines.push(
        `      <cac:Contact><cbc:ElectronicMail>${esc(buyer.email)}</cbc:ElectronicMail></cac:Contact>`,
      );
    }
    lines.push(`    </cac:Party>`);
    lines.push(`  </cac:AccountingCustomerParty>`);

    // --- Payment instructions (BG-16, required by BR-DE-1) ---
    const account = payeeAccount(seller);
    lines.push(`  <cac:PaymentMeans>`);
    if (account) {
      lines.push(`    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>`);
      lines.push(`    <cbc:PaymentID>${esc(data.invoice_number)}</cbc:PaymentID>`);
      lines.push(`    <cac:PayeeFinancialAccount>`);
      lines.push(`      <cbc:ID>${esc(account.iban)}</cbc:ID>`);
      lines.push(`      <cbc:Name>${esc(account.holder)}</cbc:Name>`);
      if (account.bic) {
        lines.push(
          `      <cac:FinancialInstitutionBranch><cbc:ID>${esc(account.bic)}</cbc:ID></cac:FinancialInstitutionBranch>`,
        );
      }
      lines.push(`    </cac:PayeeFinancialAccount>`);
    } else {
      // No IBAN in the bank details: "instrument not defined".
      lines.push(`    <cbc:PaymentMeansCode>1</cbc:PaymentMeansCode>`);
      lines.push(`    <cbc:PaymentID>${esc(data.invoice_number)}</cbc:PaymentID>`);
    }
    lines.push(`  </cac:PaymentMeans>`);

    if (data.payment_terms) {
      lines.push(
        `  <cac:PaymentTerms><cbc:Note>${esc(data.payment_terms)}</cbc:Note></cac:PaymentTerms>`,
      );
    }

    // Document discount: one allowance per VAT category (BR-32).
    for (const g of groups) {
      if (g.allowance <= 0) continue;
      lines.push(`  <cac:AllowanceCharge>`);
      lines.push(`    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>`);
      lines.push(`    <cbc:AllowanceChargeReason>Rabatt</cbc:AllowanceChargeReason>`);
      lines.push(`    <cbc:Amount currencyID="${cur}">${amt(g.allowance)}</cbc:Amount>`);
      pushTaxCategory(lines, "    ", "TaxCategory", g.category, g.rate, null);
      lines.push(`  </cac:AllowanceCharge>`);
    }

    // --- VAT breakdown (BG-23) ---
    lines.push(`  <cac:TaxTotal>`);
    lines.push(`    <cbc:TaxAmount currencyID="${cur}">${amt(totals.taxTotal)}</cbc:TaxAmount>`);
    for (const g of groups) {
      lines.push(`    <cac:TaxSubtotal>`);
      lines.push(
        `      <cbc:TaxableAmount currencyID="${cur}">${amt(g.taxable)}</cbc:TaxableAmount>`,
      );
      lines.push(`      <cbc:TaxAmount currencyID="${cur}">${amt(g.tax)}</cbc:TaxAmount>`);
      pushTaxCategory(lines, "      ", "TaxCategory", g.category, g.rate, g.reason);
      lines.push(`    </cac:TaxSubtotal>`);
    }
    lines.push(`  </cac:TaxTotal>`);

    // --- Document totals (BG-22) ---
    lines.push(`  <cac:LegalMonetaryTotal>`);
    lines.push(
      `    <cbc:LineExtensionAmount currencyID="${cur}">${amt(totals.lineTotal)}</cbc:LineExtensionAmount>`,
    );
    lines.push(
      `    <cbc:TaxExclusiveAmount currencyID="${cur}">${amt(totals.taxBasis)}</cbc:TaxExclusiveAmount>`,
    );
    lines.push(
      `    <cbc:TaxInclusiveAmount currencyID="${cur}">${amt(totals.grandTotal)}</cbc:TaxInclusiveAmount>`,
    );
    if (totals.allowanceTotal > 0) {
      lines.push(
        `    <cbc:AllowanceTotalAmount currencyID="${cur}">${amt(totals.allowanceTotal)}</cbc:AllowanceTotalAmount>`,
      );
    }
    lines.push(
      `    <cbc:PayableAmount currencyID="${cur}">${amt(totals.grandTotal)}</cbc:PayableAmount>`,
    );
    lines.push(`  </cac:LegalMonetaryTotal>`);

    // --- Lines (BG-25) ---
    const lineTag = isCredit ? "CreditNoteLine" : "InvoiceLine";
    const qtyTag = isCredit ? "CreditedQuantity" : "InvoicedQuantity";
    data.items.forEach((item, i) => {
      const category = vatCategory(item.tax_category_code, item.tax_rate, data);
      lines.push(`  <cac:${lineTag}>`);
      lines.push(`    <cbc:ID>${i + 1}</cbc:ID>`);
      lines.push(
        `    <cbc:${qtyTag} unitCode="${unitCode(item.unit)}">${item.quantity}</cbc:${qtyTag}>`,
      );
      lines.push(
        `    <cbc:LineExtensionAmount currencyID="${cur}">${amt(item.line_total)}</cbc:LineExtensionAmount>`,
      );
      lines.push(`    <cac:Item>`);
      lines.push(`      <cbc:Name>${esc(item.description)}</cbc:Name>`);
      pushTaxCategory(
        lines,
        "      ",
        "ClassifiedTaxCategory",
        category,
        vatRate(category, item.tax_rate),
        null,
      );
      lines.push(`    </cac:Item>`);
      lines.push(`    <cac:Price>`);
      lines.push(
        `      <cbc:PriceAmount currencyID="${cur}">${amt(item.unit_price)}</cbc:PriceAmount>`,
      );
      lines.push(`    </cac:Price>`);
      lines.push(`  </cac:${lineTag}>`);
    });

    lines.push(`</${rootTag}>`);
    return lines.join("\n");
  }
}

/** cac:PostalAddress in UBL AddressType order (CityName before PostalZone). */
function pushAddress(
  lines: string[],
  a: {
    street: string | null;
    additional: string | null;
    city: string | null;
    postalCode: string | null;
    subentity: string | null;
    country: string | null;
  },
): void {
  lines.push(`      <cac:PostalAddress>`);
  if (a.street) lines.push(`        <cbc:StreetName>${esc(a.street)}</cbc:StreetName>`);
  if (a.additional) {
    lines.push(`        <cbc:AdditionalStreetName>${esc(a.additional)}</cbc:AdditionalStreetName>`);
  }
  if (a.city) lines.push(`        <cbc:CityName>${esc(a.city)}</cbc:CityName>`);
  if (a.postalCode) lines.push(`        <cbc:PostalZone>${esc(a.postalCode)}</cbc:PostalZone>`);
  if (a.subentity) {
    lines.push(`        <cbc:CountrySubentity>${esc(a.subentity)}</cbc:CountrySubentity>`);
  }
  if (a.country) {
    lines.push(
      `        <cac:Country><cbc:IdentificationCode>${esc(a.country.toUpperCase())}</cbc:IdentificationCode></cac:Country>`,
    );
  }
  lines.push(`      </cac:PostalAddress>`);
}

function pushTaxScheme(lines: string[], companyId: string, scheme: string): void {
  lines.push(`      <cac:PartyTaxScheme>`);
  lines.push(`        <cbc:CompanyID>${esc(companyId)}</cbc:CompanyID>`);
  lines.push(`        <cac:TaxScheme><cbc:ID>${scheme}</cbc:ID></cac:TaxScheme>`);
  lines.push(`      </cac:PartyTaxScheme>`);
}

/** TaxCategory / ClassifiedTaxCategory in UBL TaxCategoryType order. */
function pushTaxCategory(
  lines: string[],
  indent: string,
  tag: string,
  category: string,
  rate: number,
  reason: string | null,
): void {
  lines.push(`${indent}<cac:${tag}>`);
  lines.push(`${indent}  <cbc:ID>${category}</cbc:ID>`);
  if (hasPercent(category)) lines.push(`${indent}  <cbc:Percent>${rate}</cbc:Percent>`);
  if (reason) {
    lines.push(`${indent}  <cbc:TaxExemptionReason>${esc(reason)}</cbc:TaxExemptionReason>`);
  }
  lines.push(`${indent}  <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>`);
  lines.push(`${indent}</cac:${tag}>`);
}
