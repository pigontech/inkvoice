import type { XmlProfile } from "../base-profile";
import { amt, cleanIban, decimal, esc, percent, prepareEn16931 } from "../en16931";
import type { XmlInvoiceData } from "../types";

// Factur-X 1.0 / ZUGFeRD 2.x, profile EN 16931 (COMFORT): UN/CEFACT Cross
// Industry Invoice D16B. Used as the XML embedded in the ZUGFeRD PDF/A-3
// hybrid and as a standalone CII e-invoice. Element order follows the CII
// schema; the EN 16931 rules are checked by the KoSIT validator.

/** Guideline ID (BT-24) of the EN 16931 profile. */
export const FACTURX_EN16931_ID = "urn:cen.eu:en16931:2017";

function date102(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, "");
}

export class FacturxZugferdProfile implements XmlProfile {
  getProfileId(): string {
    return "facturx-zugferd";
  }
  getProfileName(): string {
    return "Factur-X / ZUGFeRD (EN 16931)";
  }
  getMimeType(): string {
    return "application/xml";
  }

  generateXml(data: XmlInvoiceData): string {
    const doc = prepareEn16931(data);
    const s = data.supplier;
    const c = data.customer;
    const cur = esc(data.currency);
    const L: string[] = [];

    L.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    L.push(`<rsm:CrossIndustryInvoice`);
    L.push(`  xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"`);
    L.push(
      `  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"`,
    );
    L.push(`  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"`);
    L.push(`  xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">`);

    L.push(`  <rsm:ExchangedDocumentContext>`);
    L.push(`    <ram:GuidelineSpecifiedDocumentContextParameter>`);
    L.push(`      <ram:ID>${FACTURX_EN16931_ID}</ram:ID>`);
    L.push(`    </ram:GuidelineSpecifiedDocumentContextParameter>`);
    L.push(`  </rsm:ExchangedDocumentContext>`);

    L.push(`  <rsm:ExchangedDocument>`);
    L.push(`    <ram:ID>${esc(data.invoice_number)}</ram:ID>`);
    L.push(`    <ram:TypeCode>${doc.credit ? "381" : "380"}</ram:TypeCode>`);
    L.push(
      `    <ram:IssueDateTime><udt:DateTimeString format="102">${date102(data.issue_date)}</udt:DateTimeString></ram:IssueDateTime>`,
    );
    for (const note of doc.notes) {
      L.push(`    <ram:IncludedNote><ram:Content>${esc(note)}</ram:Content></ram:IncludedNote>`);
    }
    L.push(`  </rsm:ExchangedDocument>`);

    L.push(`  <rsm:SupplyChainTradeTransaction>`);

    // --- Lines (BG-25) ---
    for (const line of doc.lines) {
      L.push(`    <ram:IncludedSupplyChainTradeLineItem>`);
      L.push(
        `      <ram:AssociatedDocumentLineDocument><ram:LineID>${line.index}</ram:LineID></ram:AssociatedDocumentLineDocument>`,
      );
      L.push(
        `      <ram:SpecifiedTradeProduct><ram:Name>${esc(line.name)}</ram:Name></ram:SpecifiedTradeProduct>`,
      );
      L.push(`      <ram:SpecifiedLineTradeAgreement>`);
      L.push(
        `        <ram:NetPriceProductTradePrice><ram:ChargeAmount>${decimal(line.price, 2)}</ram:ChargeAmount></ram:NetPriceProductTradePrice>`,
      );
      L.push(`      </ram:SpecifiedLineTradeAgreement>`);
      L.push(
        `      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${mapUnitCode(line.unit)}">${decimal(line.quantity)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>`,
      );
      L.push(`      <ram:SpecifiedLineTradeSettlement>`);
      L.push(`        <ram:ApplicableTradeTax>`);
      L.push(`          <ram:TypeCode>VAT</ram:TypeCode>`);
      L.push(`          <ram:CategoryCode>${line.category}</ram:CategoryCode>`);
      if (line.category !== "O") {
        L.push(
          `          <ram:RateApplicablePercent>${percent(line.rate)}</ram:RateApplicablePercent>`,
        );
      }
      L.push(`        </ram:ApplicableTradeTax>`);
      L.push(`        <ram:SpecifiedTradeSettlementLineMonetarySummation>`);
      L.push(`          <ram:LineTotalAmount>${amt(line.net)}</ram:LineTotalAmount>`);
      L.push(`        </ram:SpecifiedTradeSettlementLineMonetarySummation>`);
      L.push(`      </ram:SpecifiedLineTradeSettlement>`);
      L.push(`    </ram:IncludedSupplyChainTradeLineItem>`);
    }

    // --- Seller and buyer (BG-4, BG-7) ---
    L.push(`    <ram:ApplicableHeaderTradeAgreement>`);
    if (c.leitweg_id) L.push(`      <ram:BuyerReference>${esc(c.leitweg_id)}</ram:BuyerReference>`);
    L.push(`      <ram:SellerTradeParty>`);
    // BR-CO-26: without a VAT ID the tax number identifies the seller (BT-29).
    if (!doc.sellerVatId && s.tax_number) L.push(`        <ram:ID>${esc(s.tax_number)}</ram:ID>`);
    L.push(`        <ram:Name>${esc(s.name)}</ram:Name>`);
    if (s.phone || s.email) {
      L.push(`        <ram:DefinedTradeContact>`);
      L.push(`          <ram:PersonName>${esc(s.name)}</ram:PersonName>`);
      if (s.phone) {
        L.push(
          `          <ram:TelephoneUniversalCommunication><ram:CompleteNumber>${esc(s.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>`,
        );
      }
      if (s.email) {
        L.push(
          `          <ram:EmailURIUniversalCommunication><ram:URIID>${esc(s.email)}</ram:URIID></ram:EmailURIUniversalCommunication>`,
        );
      }
      L.push(`        </ram:DefinedTradeContact>`);
    }
    L.push(`        <ram:PostalTradeAddress>`);
    if (s.postal_code)
      L.push(`          <ram:PostcodeCode>${esc(s.postal_code)}</ram:PostcodeCode>`);
    if (s.street || s.address)
      L.push(`          <ram:LineOne>${esc(s.street || s.address)}</ram:LineOne>`);
    if (s.city) L.push(`          <ram:CityName>${esc(s.city)}</ram:CityName>`);
    L.push(`          <ram:CountryID>${esc(s.country)}</ram:CountryID>`);
    L.push(`        </ram:PostalTradeAddress>`);
    if (s.peppol_endpoint_id) {
      L.push(
        `        <ram:URIUniversalCommunication><ram:URIID schemeID="${esc(s.peppol_scheme_id || "0208")}">${esc(s.peppol_endpoint_id)}</ram:URIID></ram:URIUniversalCommunication>`,
      );
    } else if (s.email) {
      L.push(
        `        <ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(s.email)}</ram:URIID></ram:URIUniversalCommunication>`,
      );
    }
    if (doc.sellerVatId) {
      L.push(
        `        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(doc.sellerVatId)}</ram:ID></ram:SpecifiedTaxRegistration>`,
      );
    }
    if (s.tax_number) {
      L.push(
        `        <ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${esc(s.tax_number)}</ram:ID></ram:SpecifiedTaxRegistration>`,
      );
    }
    L.push(`      </ram:SellerTradeParty>`);

    L.push(`      <ram:BuyerTradeParty>`);
    if (c.siren) {
      L.push(`        <ram:ID schemeID="0009">${esc(c.siren)}</ram:ID>`);
    } else if (c.siret) {
      L.push(`        <ram:ID schemeID="0002">${esc(c.siret)}</ram:ID>`);
    }
    L.push(`        <ram:Name>${esc(c.name)}</ram:Name>`);
    L.push(`        <ram:PostalTradeAddress>`);
    if (c.postal_code)
      L.push(`          <ram:PostcodeCode>${esc(c.postal_code)}</ram:PostcodeCode>`);
    if (c.address_line1) L.push(`          <ram:LineOne>${esc(c.address_line1)}</ram:LineOne>`);
    if (c.address_line2) L.push(`          <ram:LineTwo>${esc(c.address_line2)}</ram:LineTwo>`);
    if (c.city) L.push(`          <ram:CityName>${esc(c.city)}</ram:CityName>`);
    L.push(`          <ram:CountryID>${esc((c.country || "").toUpperCase())}</ram:CountryID>`);
    if (c.state) {
      L.push(`          <ram:CountrySubDivisionName>${esc(c.state)}</ram:CountrySubDivisionName>`);
    }
    L.push(`        </ram:PostalTradeAddress>`);
    if (c.leitweg_id) {
      L.push(
        `        <ram:URIUniversalCommunication><ram:URIID schemeID="0204">${esc(c.leitweg_id)}</ram:URIID></ram:URIUniversalCommunication>`,
      );
    } else if (c.einvoice_receiver_id) {
      L.push(
        `        <ram:URIUniversalCommunication><ram:URIID schemeID="${esc(c.einvoice_receiver_scheme || "0088")}">${esc(c.einvoice_receiver_id)}</ram:URIID></ram:URIUniversalCommunication>`,
      );
    } else if (c.email) {
      L.push(
        `        <ram:URIUniversalCommunication><ram:URIID schemeID="EM">${esc(c.email)}</ram:URIID></ram:URIUniversalCommunication>`,
      );
    }
    if (doc.buyerVatId) {
      L.push(
        `        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(doc.buyerVatId)}</ram:ID></ram:SpecifiedTaxRegistration>`,
      );
    }
    L.push(`      </ram:BuyerTradeParty>`);
    L.push(`    </ram:ApplicableHeaderTradeAgreement>`);

    // --- Delivery: the date of supply (BT-72) ---
    if (data.service_date) {
      L.push(`    <ram:ApplicableHeaderTradeDelivery>`);
      L.push(`      <ram:ActualDeliverySupplyChainEvent>`);
      L.push(
        `        <ram:OccurrenceDateTime><udt:DateTimeString format="102">${date102(data.service_date)}</udt:DateTimeString></ram:OccurrenceDateTime>`,
      );
      L.push(`      </ram:ActualDeliverySupplyChainEvent>`);
      L.push(`    </ram:ApplicableHeaderTradeDelivery>`);
    } else {
      L.push(`    <ram:ApplicableHeaderTradeDelivery />`);
    }

    // --- Settlement: payment, VAT breakdown, allowances, terms, totals ---
    L.push(`    <ram:ApplicableHeaderTradeSettlement>`);
    L.push(`      <ram:PaymentReference>${esc(data.invoice_number)}</ram:PaymentReference>`);
    L.push(`      <ram:InvoiceCurrencyCode>${cur}</ram:InvoiceCurrencyCode>`);
    const iban = cleanIban(s.iban);
    if (iban) {
      L.push(`      <ram:SpecifiedTradeSettlementPaymentMeans>`);
      L.push(`        <ram:TypeCode>58</ram:TypeCode>`);
      L.push(`        <ram:PayeePartyCreditorFinancialAccount>`);
      L.push(`          <ram:IBANID>${esc(iban)}</ram:IBANID>`);
      L.push(`          <ram:AccountName>${esc(s.account_holder || s.name)}</ram:AccountName>`);
      L.push(`        </ram:PayeePartyCreditorFinancialAccount>`);
      if (s.bic) {
        L.push(
          `        <ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${esc(s.bic.replace(/\s+/g, ""))}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>`,
        );
      }
      L.push(`      </ram:SpecifiedTradeSettlementPaymentMeans>`);
    }
    for (const g of doc.groups) {
      L.push(`      <ram:ApplicableTradeTax>`);
      L.push(`        <ram:CalculatedAmount>${amt(g.tax)}</ram:CalculatedAmount>`);
      L.push(`        <ram:TypeCode>VAT</ram:TypeCode>`);
      if (g.exemptionReason) {
        L.push(`        <ram:ExemptionReason>${esc(g.exemptionReason)}</ram:ExemptionReason>`);
      }
      L.push(`        <ram:BasisAmount>${amt(g.taxable)}</ram:BasisAmount>`);
      L.push(`        <ram:CategoryCode>${g.category}</ram:CategoryCode>`);
      if (g.exemptionCode) {
        L.push(`        <ram:ExemptionReasonCode>${g.exemptionCode}</ram:ExemptionReasonCode>`);
      }
      if (g.category !== "O") {
        L.push(`        <ram:RateApplicablePercent>${percent(g.rate)}</ram:RateApplicablePercent>`);
      }
      L.push(`      </ram:ApplicableTradeTax>`);
    }
    // Service period (BG-14).
    if (data.service_period) {
      L.push(`      <ram:BillingSpecifiedPeriod>`);
      L.push(
        `        <ram:StartDateTime><udt:DateTimeString format="102">${date102(data.service_period.start)}</udt:DateTimeString></ram:StartDateTime>`,
      );
      L.push(
        `        <ram:EndDateTime><udt:DateTimeString format="102">${date102(data.service_period.end)}</udt:DateTimeString></ram:EndDateTime>`,
      );
      L.push(`      </ram:BillingSpecifiedPeriod>`);
    }
    for (const g of doc.groups) {
      if (!g.allowance) continue;
      const charge = g.allowance < 0;
      L.push(`      <ram:SpecifiedTradeAllowanceCharge>`);
      L.push(
        `        <ram:ChargeIndicator><udt:Indicator>${charge ? "true" : "false"}</udt:Indicator></ram:ChargeIndicator>`,
      );
      L.push(`        <ram:ActualAmount>${amt(Math.abs(g.allowance))}</ram:ActualAmount>`);
      L.push(`        <ram:Reason>${charge ? "Zuschlag" : "Rabatt"}</ram:Reason>`);
      L.push(`        <ram:CategoryTradeTax>`);
      L.push(`          <ram:TypeCode>VAT</ram:TypeCode>`);
      L.push(`          <ram:CategoryCode>${g.category}</ram:CategoryCode>`);
      if (g.category !== "O") {
        L.push(
          `          <ram:RateApplicablePercent>${percent(g.rate)}</ram:RateApplicablePercent>`,
        );
      }
      L.push(`        </ram:CategoryTradeTax>`);
      L.push(`      </ram:SpecifiedTradeAllowanceCharge>`);
    }
    if (data.payment_terms || data.due_date) {
      L.push(`      <ram:SpecifiedTradePaymentTerms>`);
      if (data.payment_terms) {
        L.push(`        <ram:Description>${esc(data.payment_terms)}</ram:Description>`);
      }
      if (data.due_date) {
        L.push(
          `        <ram:DueDateDateTime><udt:DateTimeString format="102">${date102(data.due_date)}</udt:DateTimeString></ram:DueDateDateTime>`,
        );
      }
      L.push(`      </ram:SpecifiedTradePaymentTerms>`);
    }
    L.push(`      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>`);
    L.push(`        <ram:LineTotalAmount>${amt(doc.lineTotal)}</ram:LineTotalAmount>`);
    if (doc.chargeTotal)
      L.push(`        <ram:ChargeTotalAmount>${amt(doc.chargeTotal)}</ram:ChargeTotalAmount>`);
    if (doc.allowanceTotal) {
      L.push(
        `        <ram:AllowanceTotalAmount>${amt(doc.allowanceTotal)}</ram:AllowanceTotalAmount>`,
      );
    }
    L.push(`        <ram:TaxBasisTotalAmount>${amt(doc.taxBasis)}</ram:TaxBasisTotalAmount>`);
    L.push(
      `        <ram:TaxTotalAmount currencyID="${cur}">${amt(doc.taxTotal)}</ram:TaxTotalAmount>`,
    );
    L.push(`        <ram:GrandTotalAmount>${amt(doc.grandTotal)}</ram:GrandTotalAmount>`);
    L.push(`        <ram:DuePayableAmount>${amt(doc.grandTotal)}</ram:DuePayableAmount>`);
    L.push(`      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>`);
    if (data.preceding_invoice) {
      L.push(`      <ram:InvoiceReferencedDocument>`);
      L.push(
        `        <ram:IssuerAssignedID>${esc(data.preceding_invoice.number)}</ram:IssuerAssignedID>`,
      );
      if (data.preceding_invoice.issue_date) {
        L.push(
          `        <ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${date102(data.preceding_invoice.issue_date)}</qdt:DateTimeString></ram:FormattedIssueDateTime>`,
        );
      }
      L.push(`      </ram:InvoiceReferencedDocument>`);
    }
    L.push(`    </ram:ApplicableHeaderTradeSettlement>`);
    L.push(`  </rsm:SupplyChainTradeTransaction>`);
    L.push(`</rsm:CrossIndustryInvoice>`);

    return L.join("\n");
  }
}

function mapUnitCode(unit: string): string {
  const map: Record<string, string> = {
    piece: "C62",
    hour: "HUR",
    day: "DAY",
    kg: "KGM",
    meter: "MTR",
    lump_sum: "LS",
    month: "MON",
  };
  return map[unit] || "C62";
}
