import type { XmlProfile } from "../base-profile";
import type { XmlInvoiceData, XmlLineItem, XmlTaxBreakdown } from "../types";

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

export class UblPeppolProfile implements XmlProfile {
  getProfileId(): string {
    return "ubl-peppol";
  }
  getProfileName(): string {
    return "UBL 2.1 (PEPPOL BIS Billing 3.0)";
  }
  getMimeType(): string {
    return "application/xml";
  }

  generateXml(data: XmlInvoiceData): string {
    const isCredit = data.type === "credit_note";
    const rootTag = isCredit ? "CreditNote" : "Invoice";
    const ns = isCredit
      ? 'xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"'
      : 'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"';

    const lines: string[] = [];
    lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    lines.push(`<${rootTag} ${ns}`);
    lines.push(
      `  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"`,
    );
    lines.push(
      `  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`,
    );

    lines.push(
      `  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>`,
    );
    lines.push(`  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>`);
    lines.push(`  <cbc:ID>${esc(data.invoice_number)}</cbc:ID>`);
    lines.push(`  <cbc:IssueDate>${data.issue_date}</cbc:IssueDate>`);
    if (data.due_date) {
      lines.push(`  <cbc:DueDate>${data.due_date}</cbc:DueDate>`);
    }
    // 380 = Commercial Invoice, 381 = Credit Note
    lines.push(
      `  <cbc:${isCredit ? "CreditNoteTypeCode" : "InvoiceTypeCode"}>${isCredit ? "381" : "380"}</cbc:${isCredit ? "CreditNoteTypeCode" : "InvoiceTypeCode"}>`,
    );
    if (data.notes) {
      lines.push(`  <cbc:Note>${esc(data.notes)}</cbc:Note>`);
    }
    lines.push(`  <cbc:DocumentCurrencyCode>${esc(data.currency)}</cbc:DocumentCurrencyCode>`);

    // Supplier
    lines.push(`  <cac:AccountingSupplierParty>`);
    lines.push(`    <cac:Party>`);
    if (data.supplier.peppol_endpoint_id) {
      lines.push(
        `      <cbc:EndpointID schemeID="${esc(data.supplier.peppol_scheme_id || "0088")}">${esc(data.supplier.peppol_endpoint_id)}</cbc:EndpointID>`,
      );
    }
    lines.push(
      `      <cac:PartyName><cbc:Name>${esc(data.supplier.name)}</cbc:Name></cac:PartyName>`,
    );
    lines.push(`      <cac:PostalAddress>`);
    if (data.supplier.address) {
      lines.push(`        <cbc:StreetName>${esc(data.supplier.address)}</cbc:StreetName>`);
    }
    if (data.supplier.country) {
      lines.push(
        `        <cac:Country><cbc:IdentificationCode>${esc(data.supplier.country)}</cbc:IdentificationCode></cac:Country>`,
      );
    }
    lines.push(`      </cac:PostalAddress>`);
    if (data.supplier.tax_id) {
      lines.push(`      <cac:PartyTaxScheme>`);
      lines.push(`        <cbc:CompanyID>${esc(data.supplier.tax_id)}</cbc:CompanyID>`);
      lines.push(`        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>`);
      lines.push(`      </cac:PartyTaxScheme>`);
    }
    lines.push(
      `      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(data.supplier.name)}</cbc:RegistrationName></cac:PartyLegalEntity>`,
    );
    if (data.supplier.email) {
      lines.push(
        `      <cac:Contact><cbc:ElectronicMail>${esc(data.supplier.email)}</cbc:ElectronicMail></cac:Contact>`,
      );
    }
    lines.push(`    </cac:Party>`);
    lines.push(`  </cac:AccountingSupplierParty>`);

    // Customer
    lines.push(`  <cac:AccountingCustomerParty>`);
    lines.push(`    <cac:Party>`);
    lines.push(
      `      <cac:PartyName><cbc:Name>${esc(data.customer.name)}</cbc:Name></cac:PartyName>`,
    );
    lines.push(`      <cac:PostalAddress>`);
    if (data.customer.address_line1) {
      lines.push(`        <cbc:StreetName>${esc(data.customer.address_line1)}</cbc:StreetName>`);
    }
    if (data.customer.city) {
      lines.push(`        <cbc:CityName>${esc(data.customer.city)}</cbc:CityName>`);
    }
    if (data.customer.postal_code) {
      lines.push(`        <cbc:PostalZone>${esc(data.customer.postal_code)}</cbc:PostalZone>`);
    }
    if (data.customer.state) {
      lines.push(
        `        <cbc:CountrySubentity>${esc(data.customer.state)}</cbc:CountrySubentity>`,
      );
    }
    if (data.customer.country) {
      lines.push(
        `        <cac:Country><cbc:IdentificationCode>${esc(data.customer.country)}</cbc:IdentificationCode></cac:Country>`,
      );
    }
    lines.push(`      </cac:PostalAddress>`);
    if (data.customer.tax_id) {
      lines.push(`      <cac:PartyTaxScheme>`);
      lines.push(`        <cbc:CompanyID>${esc(data.customer.tax_id)}</cbc:CompanyID>`);
      lines.push(`        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>`);
      lines.push(`      </cac:PartyTaxScheme>`);
    }
    lines.push(
      `      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(data.customer.name)}</cbc:RegistrationName></cac:PartyLegalEntity>`,
    );
    if (data.customer.email) {
      lines.push(
        `      <cac:Contact><cbc:ElectronicMail>${esc(data.customer.email)}</cbc:ElectronicMail></cac:Contact>`,
      );
    }
    lines.push(`    </cac:Party>`);
    lines.push(`  </cac:AccountingCustomerParty>`);

    // Payment terms
    if (data.payment_terms) {
      lines.push(
        `  <cac:PaymentTerms><cbc:Note>${esc(data.payment_terms)}</cbc:Note></cac:PaymentTerms>`,
      );
    }

    // Discount as allowance
    if (data.discount_amount > 0) {
      lines.push(`  <cac:AllowanceCharge>`);
      lines.push(`    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>`);
      lines.push(`    <cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason>`);
      lines.push(
        `    <cbc:Amount currencyID="${esc(data.currency)}">${amt(data.discount_amount)}</cbc:Amount>`,
      );
      lines.push(`  </cac:AllowanceCharge>`);
    }

    // Tax total
    lines.push(`  <cac:TaxTotal>`);
    lines.push(
      `    <cbc:TaxAmount currencyID="${esc(data.currency)}">${amt(data.tax_total)}</cbc:TaxAmount>`,
    );
    for (const tax of data.tax_breakdown) {
      lines.push(`    <cac:TaxSubtotal>`);
      lines.push(
        `      <cbc:TaxableAmount currencyID="${esc(data.currency)}">${amt(tax.taxable_amount)}</cbc:TaxableAmount>`,
      );
      lines.push(
        `      <cbc:TaxAmount currencyID="${esc(data.currency)}">${amt(tax.tax_amount)}</cbc:TaxAmount>`,
      );
      lines.push(`      <cac:TaxCategory>`);
      lines.push(`        <cbc:ID>${esc(tax.category_code || "S")}</cbc:ID>`);
      lines.push(`        <cbc:Percent>${tax.tax_rate}</cbc:Percent>`);
      lines.push(`        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>`);
      lines.push(`      </cac:TaxCategory>`);
      lines.push(`    </cac:TaxSubtotal>`);
    }
    lines.push(`  </cac:TaxTotal>`);

    // Monetary totals
    lines.push(`  <cac:LegalMonetaryTotal>`);
    lines.push(
      `    <cbc:LineExtensionAmount currencyID="${esc(data.currency)}">${amt(data.subtotal)}</cbc:LineExtensionAmount>`,
    );
    lines.push(
      `    <cbc:TaxExclusiveAmount currencyID="${esc(data.currency)}">${amt(data.subtotal - data.discount_amount)}</cbc:TaxExclusiveAmount>`,
    );
    lines.push(
      `    <cbc:TaxInclusiveAmount currencyID="${esc(data.currency)}">${amt(data.total)}</cbc:TaxInclusiveAmount>`,
    );
    if (data.discount_amount > 0) {
      lines.push(
        `    <cbc:AllowanceTotalAmount currencyID="${esc(data.currency)}">${amt(data.discount_amount)}</cbc:AllowanceTotalAmount>`,
      );
    }
    lines.push(
      `    <cbc:PayableAmount currencyID="${esc(data.currency)}">${amt(data.total)}</cbc:PayableAmount>`,
    );
    lines.push(`  </cac:LegalMonetaryTotal>`);

    // Line items
    const lineTag = isCredit ? "CreditNoteLine" : "InvoiceLine";
    const qtyTag = isCredit ? "CreditedQuantity" : "InvoicedQuantity";
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      const unitCode = mapUnitCode(item.unit);
      lines.push(`  <cac:${lineTag}>`);
      lines.push(`    <cbc:ID>${i + 1}</cbc:ID>`);
      lines.push(`    <cbc:${qtyTag} unitCode="${unitCode}">${item.quantity}</cbc:${qtyTag}>`);
      lines.push(
        `    <cbc:LineExtensionAmount currencyID="${esc(data.currency)}">${amt(item.line_total)}</cbc:LineExtensionAmount>`,
      );
      lines.push(`    <cac:Item>`);
      lines.push(`      <cbc:Name>${esc(item.description)}</cbc:Name>`);
      lines.push(`      <cac:ClassifiedTaxCategory>`);
      lines.push(`        <cbc:ID>${esc(item.tax_category_code || "S")}</cbc:ID>`);
      lines.push(`        <cbc:Percent>${item.tax_rate}</cbc:Percent>`);
      lines.push(`        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>`);
      lines.push(`      </cac:ClassifiedTaxCategory>`);
      lines.push(`    </cac:Item>`);
      lines.push(`    <cac:Price>`);
      lines.push(
        `      <cbc:PriceAmount currencyID="${esc(data.currency)}">${amt(item.unit_price)}</cbc:PriceAmount>`,
      );
      lines.push(`    </cac:Price>`);
      lines.push(`  </cac:${lineTag}>`);
    }

    lines.push(`</${rootTag}>`);
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
