import type { XmlProfile } from "../base-profile";
import type { XmlInvoiceData } from "../types";

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function amt(n: number): string {
  return n.toFixed(2);
}

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

  generateXml(data: XmlInvoiceData): string {
    const isCredit = data.type === "credit_note";
    const typeCode = isCredit ? "381" : "380";

    const lines: string[] = [];
    lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    lines.push(`<rsm:CrossIndustryInvoice`);
    lines.push(`  xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"`);
    lines.push(
      `  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"`,
    );
    lines.push(`  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"`);
    lines.push(`  xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">`);

    // ExchangedDocumentContext
    lines.push(`  <rsm:ExchangedDocumentContext>`);
    lines.push(`    <ram:GuidelineSpecifiedDocumentContextParameter>`);
    lines.push(`      <ram:ID>urn:cen.eu:en16931:2017</ram:ID>`);
    lines.push(`    </ram:GuidelineSpecifiedDocumentContextParameter>`);
    lines.push(`  </rsm:ExchangedDocumentContext>`);

    // ExchangedDocument
    lines.push(`  <rsm:ExchangedDocument>`);
    lines.push(`    <ram:ID>${esc(data.invoice_number)}</ram:ID>`);
    lines.push(`    <ram:TypeCode>${typeCode}</ram:TypeCode>`);
    lines.push(
      `    <ram:IssueDateTime><udt:DateTimeString format="102">${data.issue_date.replace(/-/g, "")}</udt:DateTimeString></ram:IssueDateTime>`,
    );
    if (data.notes) {
      lines.push(
        `    <ram:IncludedNote><ram:Content>${esc(data.notes)}</ram:Content></ram:IncludedNote>`,
      );
    }
    lines.push(`  </rsm:ExchangedDocument>`);

    // SupplyChainTradeTransaction
    lines.push(`  <rsm:SupplyChainTradeTransaction>`);

    // Line items
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
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
        `      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${mapUnitCode(item.unit)}">${item.quantity}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>`,
      );
      lines.push(`      <ram:SpecifiedLineTradeSettlement>`);
      lines.push(`        <ram:ApplicableTradeTax>`);
      lines.push(`          <ram:TypeCode>VAT</ram:TypeCode>`);
      lines.push(
        `          <ram:CategoryCode>${esc(item.tax_category_code || "S")}</ram:CategoryCode>`,
      );
      lines.push(
        `          <ram:RateApplicablePercent>${item.tax_rate}</ram:RateApplicablePercent>`,
      );
      lines.push(`        </ram:ApplicableTradeTax>`);
      lines.push(`        <ram:SpecifiedTradeSettlementLineMonetarySummation>`);
      lines.push(`          <ram:LineTotalAmount>${amt(item.line_total)}</ram:LineTotalAmount>`);
      lines.push(`        </ram:SpecifiedTradeSettlementLineMonetarySummation>`);
      lines.push(`      </ram:SpecifiedLineTradeSettlement>`);
      lines.push(`    </ram:IncludedSupplyChainTradeLineItem>`);
    }

    // ApplicableHeaderTradeAgreement (Supplier + Customer)
    lines.push(`    <ram:ApplicableHeaderTradeAgreement>`);
    lines.push(`      <ram:SellerTradeParty>`);
    lines.push(`        <ram:Name>${esc(data.supplier.name)}</ram:Name>`);
    if (data.supplier.address) {
      lines.push(
        `        <ram:PostalTradeAddress><ram:LineOne>${esc(data.supplier.address)}</ram:LineOne>`,
      );
      if (data.supplier.country) {
        lines.push(`          <ram:CountryID>${esc(data.supplier.country)}</ram:CountryID>`);
      }
      lines.push(`        </ram:PostalTradeAddress>`);
    }
    if (data.supplier.tax_id) {
      lines.push(
        `        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(data.supplier.tax_id)}</ram:ID></ram:SpecifiedTaxRegistration>`,
      );
    }
    lines.push(`      </ram:SellerTradeParty>`);
    lines.push(`      <ram:BuyerTradeParty>`);
    lines.push(`        <ram:Name>${esc(data.customer.name)}</ram:Name>`);
    if (data.customer.address_line1) {
      lines.push(`        <ram:PostalTradeAddress>`);
      lines.push(`          <ram:LineOne>${esc(data.customer.address_line1)}</ram:LineOne>`);
      if (data.customer.city)
        lines.push(`          <ram:CityName>${esc(data.customer.city)}</ram:CityName>`);
      if (data.customer.postal_code)
        lines.push(
          `          <ram:PostcodeCode>${esc(data.customer.postal_code)}</ram:PostcodeCode>`,
        );
      if (data.customer.country)
        lines.push(`          <ram:CountryID>${esc(data.customer.country)}</ram:CountryID>`);
      lines.push(`        </ram:PostalTradeAddress>`);
    }
    if (data.customer.tax_id) {
      lines.push(
        `        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(data.customer.tax_id)}</ram:ID></ram:SpecifiedTaxRegistration>`,
      );
    }
    lines.push(`      </ram:BuyerTradeParty>`);
    lines.push(`    </ram:ApplicableHeaderTradeAgreement>`);

    // Delivery
    lines.push(`    <ram:ApplicableHeaderTradeDelivery />`);

    // Settlement
    lines.push(`    <ram:ApplicableHeaderTradeSettlement>`);
    lines.push(`      <ram:InvoiceCurrencyCode>${esc(data.currency)}</ram:InvoiceCurrencyCode>`);

    if (data.payment_terms) {
      lines.push(
        `      <ram:SpecifiedTradePaymentTerms><ram:Description>${esc(data.payment_terms)}</ram:Description></ram:SpecifiedTradePaymentTerms>`,
      );
    }

    // Tax breakdown
    for (const tax of data.tax_breakdown) {
      lines.push(`      <ram:ApplicableTradeTax>`);
      lines.push(`        <ram:CalculatedAmount>${amt(tax.tax_amount)}</ram:CalculatedAmount>`);
      lines.push(`        <ram:TypeCode>VAT</ram:TypeCode>`);
      lines.push(`        <ram:BasisAmount>${amt(tax.taxable_amount)}</ram:BasisAmount>`);
      lines.push(`        <ram:CategoryCode>${esc(tax.category_code || "S")}</ram:CategoryCode>`);
      lines.push(`        <ram:RateApplicablePercent>${tax.tax_rate}</ram:RateApplicablePercent>`);
      lines.push(`      </ram:ApplicableTradeTax>`);
    }

    // Monetary summation
    lines.push(`      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>`);
    lines.push(`        <ram:LineTotalAmount>${amt(data.subtotal)}</ram:LineTotalAmount>`);
    if (data.discount_amount > 0) {
      lines.push(
        `        <ram:AllowanceTotalAmount>${amt(data.discount_amount)}</ram:AllowanceTotalAmount>`,
      );
    }
    lines.push(
      `        <ram:TaxBasisTotalAmount>${amt(data.subtotal - data.discount_amount)}</ram:TaxBasisTotalAmount>`,
    );
    lines.push(
      `        <ram:TaxTotalAmount currencyID="${esc(data.currency)}">${amt(data.tax_total)}</ram:TaxTotalAmount>`,
    );
    lines.push(`        <ram:GrandTotalAmount>${amt(data.total)}</ram:GrandTotalAmount>`);
    lines.push(`        <ram:DuePayableAmount>${amt(data.total)}</ram:DuePayableAmount>`);
    lines.push(`      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>`);
    lines.push(`    </ram:ApplicableHeaderTradeSettlement>`);
    lines.push(`  </rsm:SupplyChainTradeTransaction>`);
    lines.push(`</rsm:CrossIndustryInvoice>`);

    return lines.join("\n");
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
