import { payeeAccount, vatGroups } from "../xml/en16931";
import type { XmlInvoiceData } from "../xml/types";

export type EinvoiceSeverity = "error" | "warning";

export interface EinvoiceIssue {
  severity: EinvoiceSeverity;
  code: string;
  message: string;
}

/**
 * Business-rule validation of invoice data before it is emitted as an
 * e-invoice (XRechnung / ZUGFeRD). Structural EN 16931 checks (invoice number,
 * monetary sums, VAT categories); German specifics (USt-IdNr format,
 * Steuernummer, reverse charge) surface as errors/warnings.
 */
export function validateEinvoice(data: XmlInvoiceData, format?: string): EinvoiceIssue[] {
  const issues: EinvoiceIssue[] = [];
  const cur = data.currency || "";

  // --- Mandatory values (§ 14 UStG) ---
  if (!data.invoice_number) {
    issues.push(error("invoice_number", "Rechnungsnummer (invoice number) is required."));
  }
  if (!data.issue_date) {
    issues.push(error("issue_date", "Invoice date is required."));
  }
  if (!data.supplier.name) {
    issues.push(error("seller_name", "Seller name is required."));
  }
  if (!data.customer.name) {
    issues.push(error("buyer_name", "Buyer name is required."));
  }
  const sellerAddr = [data.supplier.address, data.supplier.street, data.supplier.city].some(
    (v) => !!v,
  );
  if (!sellerAddr) {
    issues.push(error("seller_address", "Seller address is required (street, city)."));
  }
  const buyerAddr = [data.customer.address_line1, data.customer.city].some((v) => !!v);
  if (!buyerAddr) {
    issues.push(error("buyer_address", "Buyer address is required."));
  }

  if (!data.supplier.country) {
    issues.push(error("seller_country", "Seller country is required."));
  }
  // BR-CO-26: the seller must be identifiable. Inkvoice emits the VAT ID for
  // this; a Steuernummer (BT-32) does not satisfy the rule.
  if (!data.supplier.tax_id) {
    issues.push(
      error(
        "seller_vat_id",
        "The seller VAT ID (USt-IdNr) is required for e-invoices; a tax number alone is rejected by EN 16931 validators (BR-CO-26).",
      ),
    );
  }
  if (!payeeAccount(data.supplier)) {
    issues.push(
      warning(
        "seller_iban",
        "No valid IBAN configured (Settings → IBAN); the e-invoice will not contain bank transfer instructions.",
      ),
    );
  }

  // XRechnung (CIUS) requirements on top of EN 16931.
  if (format === "xrechnung-ubl") {
    if (!data.supplier.phone) {
      issues.push(error("seller_phone", "XRechnung requires the seller phone number (BR-DE-6)."));
    }
    if (!data.supplier.email) {
      issues.push(error("seller_email", "XRechnung requires the seller email address (BR-DE-7)."));
    }
    if (!data.customer.leitweg_id && !data.customer.einvoice_receiver_id && !data.customer.email) {
      issues.push(
        error(
          "buyer_electronic_address",
          "XRechnung requires an electronic address for the buyer: an email, Leitweg-ID or receiver ID.",
        ),
      );
    }
  }

  // German specifics
  if (
    (data.supplier.country || "").toUpperCase() === "DE" &&
    data.supplier.tax_id &&
    !/^DE\d{9}$/.test(data.supplier.tax_id.trim())
  ) {
    issues.push(
      error(
        "seller_vat_format",
        `USt-IdNr "${data.supplier.tax_id}" is not a valid German VAT ID (expected format DE123456789).`,
      ),
    );
  }
  if (
    (data.supplier.country || "").toUpperCase() === "DE" &&
    data.supplier.tax_number &&
    !/^R\d{9}$/.test(data.supplier.tax_number.trim()) &&
    !/^\d{2,5}\/\d{3,7}\/\d{3,7}$/.test(data.supplier.tax_number.trim()) &&
    !/^\d{2,4}\s?\d{3}\s?\d{3}\s?\d{4}$/.test(data.supplier.tax_number.trim())
  ) {
    issues.push(
      warning(
        "seller_tax_number_format",
        `Steuernummer "${data.supplier.tax_number}" does not look like a German tax number (e.g. 12/345/67890).`,
      ),
    );
  }

  // Buyer tax id for cross-border (reverse charge / intra-EU)
  const sellerCountry = (data.supplier.country || "").toUpperCase();
  const buyerCountry = (data.customer.country || "").toUpperCase();
  if (sellerCountry === "DE" && buyerCountry && buyerCountry !== "DE" && !data.customer.tax_id) {
    issues.push(
      warning(
        "buyer_vat_id",
        `Buyer is in ${buyerCountry}; for intra-community B2B supplies the buyer VAT ID is required (reverse charge, 0% VAT).`,
      ),
    );
  }
  if (sellerCountry === "DE" && buyerCountry === "DE" && !data.customer.tax_id) {
    issues.push(
      warning(
        "buyer_vat_id_de",
        "Buyer USt-IdNr is missing (helps your recipient process the e-invoice).",
      ),
    );
  }

  // French specifics (buyer SIREN mandatory for French recipients)
  if (
    data.france_enabled &&
    (data.customer.country || "").toUpperCase() === "FR" &&
    !data.customer.siren
  ) {
    issues.push(
      warning(
        "buyer_siren_fr",
        "Buyer SIREN is missing (required to deliver e-invoices to French businesses).",
      ),
    );
  }

  // Reverse charge / Kleinunternehmer — tax should be zero
  const anyVat = Math.abs(data.tax_total) > 0.004 || data.tax_breakdown.some((t) => t.tax_rate > 0);
  if (data.kleinunternehmer && anyVat) {
    issues.push(
      error(
        "kleinunternehmer_vat",
        "The seller is flagged as Kleinunternehmer (§ 19 UStG) but the invoice carries VAT.",
      ),
    );
  }
  if (data.franchise_fr && anyVat) {
    issues.push(
      error(
        "franchise_fr_vat",
        "The seller is flagged as franchise en base (art. 293 B CGI) but the invoice carries VAT.",
      ),
    );
  }
  if (data.document_category_code === "AE" && data.tax_total !== 0) {
    issues.push(
      error("reverse_charge_vat", "Reverse charge invoices must not charge VAT (use the 0% rate)."),
    );
  }

  // VAT categories must be valid EN 16931 values
  const validCategories = new Set(["S", "AA", "Z", "E", "AE", "K", "G", "O", "L", "M"]);
  for (const tax of data.tax_breakdown) {
    if (tax.category_code && !validCategories.has(tax.category_code.toUpperCase())) {
      issues.push(
        error(
          "tax_category",
          `Tax category "${tax.category_code}" is not a valid EN 16931 category (use S, AA, Z, E, AE, …).`,
        ),
      );
    }
  }

  // BR-CO-17: VAT per category must equal taxable amount × rate.
  for (const g of vatGroups(data)) {
    if (g.category !== "S") continue;
    const expected = Math.round(g.taxable * g.rate) / 100;
    if (Math.abs(expected - g.tax) > 0.01) {
      const discountHint =
        data.discount_amount > 0
          ? " The document discount must also reduce the VAT base (§ 10 UStG)."
          : "";
      issues.push(
        error(
          "vat_amount",
          `VAT at ${g.rate}% is ${g.tax.toFixed(2)}, but ${g.taxable.toFixed(2)} × ${g.rate}% = ${expected.toFixed(2)}.${discountHint}`,
        ),
      );
    }
  }

  // Monetary consistency (EN 16931: Tolerance)
  const expectedTaxable = data.subtotal - data.discount_amount;
  if (
    Math.abs(expectedTaxable) < 0.005 &&
    data.tax_breakdown.some((t) => Math.abs(t.taxable_amount) > 0.005)
  ) {
    issues.push(
      error("monetary_subtotal", "Tax basis from line items does not match the document subtotal."),
    );
  }
  const taxBreakdownSum = Number(
    data.tax_breakdown.reduce((s, t) => s + t.tax_amount, 0).toFixed(2),
  );
  if (Math.abs(taxBreakdownSum - data.tax_total) > 0.02) {
    issues.push(
      error(
        "monetary_tax",
        `Tax breakdown (${taxBreakdownSum.toFixed(2)}) does not match document tax total (${data.tax_total.toFixed(2)}).`,
      ),
    );
  }
  const computedTotal = Number((expectedTaxable + data.tax_total).toFixed(2));
  if (Math.abs(computedTotal - data.total) > 0.02) {
    issues.push(
      error(
        "monetary_total",
        `Total (${data.total.toFixed(
          2,
        )}) does not equal taxable amount + tax (${computedTotal.toFixed(2)}).`,
      ),
    );
  }

  // Currency
  if (!cur) {
    issues.push(error("currency", "Invoice currency is required."));
  }

  return issues;
}

function error(code: string, message: string): EinvoiceIssue {
  return { severity: "error", code, message };
}

function warning(code: string, message: string): EinvoiceIssue {
  return { severity: "warning", code, message };
}
