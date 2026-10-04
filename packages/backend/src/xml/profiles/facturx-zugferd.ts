import type { XmlProfile } from "../base-profile";
import {
  amt,
  buyerElectronicAddress,
  buyerReference,
  documentTotals,
  type ElectronicAddress,
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

// Factur-X / ZUGFeRD 2.2 — UN/CEFACT Cross Industry Invoice (CII), EN 16931
// profile. This doubles as the embedded XML part of a ZUGFeRD PDF/A-3 hybrid
// and as a standalone CII e-invoice. Element order follows the CII D16B
// schema sequences; validated against the KoSIT validator (EN 16931 CII).

export class FacturxZugferdProfile implements XmlProfile {
  getProfileId(): string {
    return "facturx-zugferd";
  }
  getProfileName(): string {
    return "Factur-X / ZUGFeRD 2.2 (EN 16931)";
  }
  getMimeType(): string {
    return "application/xml";
  }

  generateXml(input: XmlInvoiceData): string {
    const data = forEmission(input);
    const isCredit = data.type === "credit_note";
    const groups = vatGroups(data);
    const totals = documentTotals(data, groups);

    const lines: string[] = [];
    lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    lines.push(`<rsm:CrossIndustryInvoice`);
    lines.push(`  xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"`);
    lines.push(
      `  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"`,
    );
    lines.push(`  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"`);
    lines.push(`  xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">`);

    // ExchangedDocumentContext — EN 16931 profile (works for ZUGFeRD 2.1+/Factur-X)
    lines.push(`  <rsm:ExchangedDocumentContext>`);
    lines.push(`    <ram:GuidelineSpecifiedDocumentContextParameter>`);
    lines.push(`      <ram:ID>urn:cen.eu:en16931:2017</ram:ID>`);
    lines.push(`    </ram:GuidelineSpecifiedDocumentContextParameter>`);
    lines.push(`  </rsm:ExchangedDocumentContext>`);

    // ExchangedDocument
    lines.push(`  <rsm:ExchangedDocument>`);
    lines.push(`    <ram:ID>${esc(data.invoice_number)}</ram:ID>`);
    lines.push(`    <ram:TypeCode>${isCredit ? "381" : "380"}</ram:TypeCode>`);
    lines.push(`    <ram:IssueDateTime>${dateTime(data.issue_date)}</ram:IssueDateTime>`);
    if (data.notes) pushNote(lines, data.notes);
    if (data.kleinunternehmer) {
      pushNote(lines, "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.");
    }
    if (groups.some((g) => g.category === "AE")) {
      pushNote(lines, "Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge).");
    }
    lines.push(`  </rsm:ExchangedDocument>`);

    lines.push(`  <rsm:SupplyChainTradeTransaction>`);

    // Line items (BG-25)
    data.items.forEach((item, i) => {
      const category = vatCategory(item.tax_category_code, item.tax_rate, data);
      lines.push(`    <ram:IncludedSupplyChainTradeLineItem>`);
      lines.push(
        `      <ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>`,
      );
      lines.push(
        `      <ram:SpecifiedTradeProduct><ram:Name>${esc(item.description)}</ram:Name></ram:SpecifiedTradeProduct>`,
      );
      lines.push(`      <ram:SpecifiedLineTradeAgreement>`);
      lines.push(
        `        <ram:NetPriceProductTradePrice><ram:ChargeAmount>${amt(item.unit_price)}</ram:ChargeAmount></ram:NetPriceProductTradePrice>`,
      );
      lines.push(`      </ram:SpecifiedLineTradeAgreement>`);
      lines.push(
        `      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${unitCode(item.unit)}">${item.quantity}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>`,
      );
      lines.push(`      <ram:SpecifiedLineTradeSettlement>`);
      lines.push(`        <ram:ApplicableTradeTax>`);
      lines.push(`          <ram:TypeCode>VAT</ram:TypeCode>`);
      lines.push(`          <ram:CategoryCode>${category}</ram:CategoryCode>`);
      if (hasPercent(category)) {
        lines.push(
          `          <ram:RateApplicablePercent>${vatRate(category, item.tax_rate)}</ram:RateApplicablePercent>`,
        );
      }
      lines.push(`        </ram:ApplicableTradeTax>`);
      lines.push(`        <ram:SpecifiedTradeSettlementLineMonetarySummation>`);
      lines.push(`          <ram:LineTotalAmount>${amt(item.line_total)}</ram:LineTotalAmount>`);
      lines.push(`        </ram:SpecifiedTradeSettlementLineMonetarySummation>`);
      lines.push(`      </ram:SpecifiedLineTradeSettlement>`);
      lines.push(`    </ram:IncludedSupplyChainTradeLineItem>`);
    });

    // ApplicableHeaderTradeAgreement (BT-10, seller, buyer)
    const seller = data.supplier;
    const buyer = data.customer;
    lines.push(`    <ram:ApplicableHeaderTradeAgreement>`);
    lines.push(`      <ram:BuyerReference>${esc(buyerReference(data))}</ram:BuyerReference>`);

    lines.push(`      <ram:SellerTradeParty>`);
    lines.push(`        <ram:Name>${esc(seller.name)}</ram:Name>`);
    lines.push(`        <ram:DefinedTradeContact>`);
    lines.push(`          <ram:PersonName>${esc(sellerContactName(data))}</ram:PersonName>`);
    if (seller.phone) {
      lines.push(
        `          <ram:TelephoneUniversalCommunication><ram:CompleteNumber>${esc(seller.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>`,
      );
    }
    if (seller.email) {
      lines.push(
        `          <ram:EmailURIUniversalCommunication><ram:URIID>${esc(seller.email)}</ram:URIID></ram:EmailURIUniversalCommunication>`,
      );
    }
    lines.push(`        </ram:DefinedTradeContact>`);
    pushAddress(lines, {
      postalCode: seller.postal_code,
      lineOne: seller.street || seller.address,
      lineTwo: null,
      city: seller.city,
      country: seller.country,
      subdivision: null,
    });
    pushUri(lines, sellerElectronicAddress(data));
    if (seller.tax_id) pushTaxRegistration(lines, seller.tax_id, "VA");
    // BT-32 seller tax registration (Steuernummer).
    if (seller.tax_number) pushTaxRegistration(lines, seller.tax_number, "FC");
    lines.push(`      </ram:SellerTradeParty>`);

    lines.push(`      <ram:BuyerTradeParty>`);
    // French buyer identifiers (SIREN / SIRET) come first in TradePartyType.
    if (buyer.siren) {
      lines.push(`        <ram:ID schemeID="0009">${esc(buyer.siren)}</ram:ID>`);
    } else if (buyer.siret) {
      lines.push(`        <ram:ID schemeID="0002">${esc(buyer.siret)}</ram:ID>`);
    }
    lines.push(`        <ram:Name>${esc(buyer.name)}</ram:Name>`);
    pushAddress(lines, {
      postalCode: buyer.postal_code,
      lineOne: buyer.address_line1,
      lineTwo: buyer.address_line2,
      city: buyer.city,
      country: buyer.country,
      subdivision: buyer.state,
    });
    pushUri(lines, buyerElectronicAddress(data));
    // EN 16931 has no buyer tax number, only the VAT identifier (BT-48).
    if (buyer.tax_id) pushTaxRegistration(lines, buyer.tax_id, "VA");
    lines.push(`      </ram:BuyerTradeParty>`);
    lines.push(`    </ram:ApplicableHeaderTradeAgreement>`);

    lines.push(`    <ram:ApplicableHeaderTradeDelivery />`);

    // ApplicableHeaderTradeSettlement — CII sequence: payment reference,
    // currency, payment means, VAT breakdown, allowances, terms, totals.
    lines.push(`    <ram:ApplicableHeaderTradeSettlement>`);
    lines.push(`      <ram:PaymentReference>${esc(data.invoice_number)}</ram:PaymentReference>`);
    lines.push(`      <ram:InvoiceCurrencyCode>${esc(data.currency)}</ram:InvoiceCurrencyCode>`);

    const account = payeeAccount(seller);
    lines.push(`      <ram:SpecifiedTradeSettlementPaymentMeans>`);
    if (account) {
      lines.push(`        <ram:TypeCode>58</ram:TypeCode>`);
      lines.push(`        <ram:PayeePartyCreditorFinancialAccount>`);
      lines.push(`          <ram:IBANID>${esc(account.iban)}</ram:IBANID>`);
      lines.push(`          <ram:AccountName>${esc(account.holder)}</ram:AccountName>`);
      lines.push(`        </ram:PayeePartyCreditorFinancialAccount>`);
      if (account.bic) {
        lines.push(
          `        <ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${esc(account.bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>`,
        );
      }
    } else {
      // No IBAN in the bank details: "instrument not defined".
      lines.push(`        <ram:TypeCode>1</ram:TypeCode>`);
    }
    lines.push(`      </ram:SpecifiedTradeSettlementPaymentMeans>`);

    for (const g of groups) {
      lines.push(`      <ram:ApplicableTradeTax>`);
      lines.push(`        <ram:CalculatedAmount>${amt(g.tax)}</ram:CalculatedAmount>`);
      lines.push(`        <ram:TypeCode>VAT</ram:TypeCode>`);
      if (g.reason)
        lines.push(`        <ram:ExemptionReason>${esc(g.reason)}</ram:ExemptionReason>`);
      lines.push(`        <ram:BasisAmount>${amt(g.taxable)}</ram:BasisAmount>`);
      lines.push(`        <ram:CategoryCode>${g.category}</ram:CategoryCode>`);
      if (hasPercent(g.category)) {
        lines.push(`        <ram:RateApplicablePercent>${g.rate}</ram:RateApplicablePercent>`);
      }
      lines.push(`      </ram:ApplicableTradeTax>`);
    }

    // Document discount: one allowance per VAT category (BR-32).
    for (const g of groups) {
      if (g.allowance <= 0) continue;
      lines.push(`      <ram:SpecifiedTradeAllowanceCharge>`);
      lines.push(
        `        <ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator>`,
      );
      lines.push(`        <ram:ActualAmount>${amt(g.allowance)}</ram:ActualAmount>`);
      lines.push(`        <ram:Reason>Rabatt</ram:Reason>`);
      lines.push(`        <ram:CategoryTradeTax>`);
      lines.push(`          <ram:TypeCode>VAT</ram:TypeCode>`);
      lines.push(`          <ram:CategoryCode>${g.category}</ram:CategoryCode>`);
      if (hasPercent(g.category)) {
        lines.push(`          <ram:RateApplicablePercent>${g.rate}</ram:RateApplicablePercent>`);
      }
      lines.push(`        </ram:CategoryTradeTax>`);
      lines.push(`      </ram:SpecifiedTradeAllowanceCharge>`);
    }

    if (data.payment_terms || data.due_date) {
      lines.push(`      <ram:SpecifiedTradePaymentTerms>`);
      if (data.payment_terms) {
        lines.push(`        <ram:Description>${esc(data.payment_terms)}</ram:Description>`);
      }
      if (data.due_date) {
        lines.push(`        <ram:DueDateDateTime>${dateTime(data.due_date)}</ram:DueDateDateTime>`);
      }
      lines.push(`      </ram:SpecifiedTradePaymentTerms>`);
    }

    // Monetary summation (BG-22)
    lines.push(`      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>`);
    lines.push(`        <ram:LineTotalAmount>${amt(totals.lineTotal)}</ram:LineTotalAmount>`);
    if (totals.allowanceTotal > 0) {
      lines.push(
        `        <ram:AllowanceTotalAmount>${amt(totals.allowanceTotal)}</ram:AllowanceTotalAmount>`,
      );
    }
    lines.push(
      `        <ram:TaxBasisTotalAmount>${amt(totals.taxBasis)}</ram:TaxBasisTotalAmount>`,
    );
    lines.push(
      `        <ram:TaxTotalAmount currencyID="${esc(data.currency)}">${amt(totals.taxTotal)}</ram:TaxTotalAmount>`,
    );
    lines.push(`        <ram:GrandTotalAmount>${amt(totals.grandTotal)}</ram:GrandTotalAmount>`);
    lines.push(`        <ram:TotalPrepaidAmount>0.00</ram:TotalPrepaidAmount>`);
    lines.push(`        <ram:DuePayableAmount>${amt(totals.grandTotal)}</ram:DuePayableAmount>`);
    lines.push(`      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>`);
    lines.push(`    </ram:ApplicableHeaderTradeSettlement>`);
    lines.push(`  </rsm:SupplyChainTradeTransaction>`);
    lines.push(`</rsm:CrossIndustryInvoice>`);

    return lines.join("\n");
  }
}

function dateTime(isoDate: string): string {
  return `<udt:DateTimeString format="102">${isoDate.replace(/-/g, "")}</udt:DateTimeString>`;
}

function pushNote(lines: string[], content: string): void {
  lines.push(`    <ram:IncludedNote><ram:Content>${esc(content)}</ram:Content></ram:IncludedNote>`);
}

/** ram:PostalTradeAddress in CII TradeAddressType order (PostcodeCode first). */
function pushAddress(
  lines: string[],
  a: {
    postalCode: string | null;
    lineOne: string | null;
    lineTwo: string | null;
    city: string | null;
    country: string | null;
    subdivision: string | null;
  },
): void {
  lines.push(`        <ram:PostalTradeAddress>`);
  if (a.postalCode)
    lines.push(`          <ram:PostcodeCode>${esc(a.postalCode)}</ram:PostcodeCode>`);
  if (a.lineOne) lines.push(`          <ram:LineOne>${esc(a.lineOne)}</ram:LineOne>`);
  if (a.lineTwo) lines.push(`          <ram:LineTwo>${esc(a.lineTwo)}</ram:LineTwo>`);
  if (a.city) lines.push(`          <ram:CityName>${esc(a.city)}</ram:CityName>`);
  if (a.country) {
    lines.push(`          <ram:CountryID>${esc(a.country.toUpperCase())}</ram:CountryID>`);
  }
  if (a.subdivision) {
    lines.push(
      `          <ram:CountrySubDivisionName>${esc(a.subdivision)}</ram:CountrySubDivisionName>`,
    );
  }
  lines.push(`        </ram:PostalTradeAddress>`);
}

function pushUri(lines: string[], address: ElectronicAddress | null): void {
  if (!address) return;
  lines.push(
    `        <ram:URIUniversalCommunication><ram:URIID schemeID="${esc(address.scheme)}">${esc(address.id)}</ram:URIID></ram:URIUniversalCommunication>`,
  );
}

function pushTaxRegistration(lines: string[], id: string, scheme: "VA" | "FC"): void {
  lines.push(
    `        <ram:SpecifiedTaxRegistration><ram:ID schemeID="${scheme}">${esc(id)}</ram:ID></ram:SpecifiedTaxRegistration>`,
  );
}
