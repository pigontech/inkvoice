import { prepareEn16931 } from "../xml/en16931";
import type { XmlInvoiceData } from "../xml/types";

export type EinvoiceSeverity = "error" | "warning";

export interface EinvoiceIssue {
  severity: EinvoiceSeverity;
  /** Stable id; the app shows the message translated by this code. */
  code: string;
  /** English text, for API clients and codes the app has no translation for. */
  message: string;
  /** The values inside `message`, so a client can word it in another language. */
  params?: Record<string, string>;
}

/**
 * Business-rule validation of invoice data before it is emitted as an
 * e-invoice (XRechnung / ZUGFeRD). Structural EN 16931 checks (invoice number,
 * monetary sums, VAT categories); German specifics (USt-IdNr format,
 * Steuernummer, reverse charge) surface as errors/warnings. With `format`
 * "xrechnung-ubl" the XRechnung (BR-DE) requirements are checked too.
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

  // German specifics
  if ((data.supplier.country || "").toUpperCase() === "DE" && !data.supplier.tax_id) {
    issues.push(
      warning(
        "seller_vat_id",
        "USt-IdNr of the seller is missing (recommended for German invoices).",
      ),
    );
  }
  if (
    (data.supplier.country || "").toUpperCase() === "DE" &&
    data.supplier.tax_id &&
    !/^DE\d{9}$/.test(data.supplier.tax_id.trim())
  ) {
    issues.push(
      error(
        "seller_vat_format",
        `USt-IdNr "${data.supplier.tax_id}" is not a valid German VAT ID (expected format DE123456789).`,
        { vat_id: data.supplier.tax_id },
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
        { tax_number: data.supplier.tax_number },
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
        { country: buyerCountry },
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
          { category: tax.category_code },
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
        { breakdown: taxBreakdownSum.toFixed(2), tax_total: data.tax_total.toFixed(2) },
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
        { total: data.total.toFixed(2), expected: computedTotal.toFixed(2) },
      ),
    );
  }

  // Currency
  if (!cur) {
    issues.push(error("currency", "Invoice currency is required."));
  }

  issues.push(...en16931Checks(data));
  if (format === "xrechnung-ubl") issues.push(...xrechnungChecks(data));

  return issues;
}

/** EN 16931 rules every format must meet (XRechnung, ZUGFeRD, PEPPOL). */
function en16931Checks(data: XmlInvoiceData): EinvoiceIssue[] {
  const issues: EinvoiceIssue[] = [];
  const s = data.supplier;
  const c = data.customer;
  if (!s.country) {
    issues.push(
      error("seller_country", "Your country is required (Settings → E-invoicing). [BR-9]"),
    );
  }
  if (!c.country) {
    issues.push(error("buyer_country", "The customer's country is required. [BR-11]"));
  }
  if (!s.tax_id && !s.tax_number) {
    issues.push(
      error(
        "seller_tax_registration",
        "Add your USt-IdNr or your Steuernummer (Settings). [BR-S-02, BR-E-02, BR-CO-26]",
      ),
    );
  }
  if (data.type !== "credit_note" && data.total > 0.004 && !data.due_date && !data.payment_terms) {
    issues.push(
      warning("payment_due", "Set a due date or payment terms on the invoice. [BR-CO-25]"),
    );
  }
  if (!s.iban) {
    issues.push(
      warning(
        "payment_iban",
        "No IBAN in Settings, so the e-invoice carries no bank details for the transfer.",
      ),
    );
  }
  if (data.items.length > 0) {
    const doc = prepareEn16931(data);
    if (doc.groups.some((g) => g.category === "AE") && (!s.tax_id || !c.tax_id)) {
      issues.push(
        error(
          "reverse_charge_vat_ids",
          "Reverse charge needs your USt-IdNr and the customer's VAT ID. [BR-AE-02]",
        ),
      );
    }
    const notSubject = doc.groups.some((g) => g.category === "O");
    if (notSubject && doc.groups.some((g) => g.category !== "O")) {
      issues.push(
        error(
          "not_subject_mixed",
          "Lines not subject to VAT (category O) can't share an invoice with other VAT categories. Bill them on a separate invoice. [BR-O-11]",
        ),
      );
    }
    if (notSubject && s.tax_id && !s.tax_number) {
      issues.push(
        error(
          "not_subject_tax_number",
          "An invoice not subject to VAT (category O) can't carry your USt-IdNr, so it needs your Steuernummer (Settings). [BR-O-02, BR-CO-26]",
        ),
      );
    }
    // An intra-community supply sends the customer's address as the deliver-to
    // address (BR-IC-12); it also needs both VAT IDs and the date of supply.
    if (doc.intraCommunity && (!s.tax_id || !c.tax_id)) {
      issues.push(
        error(
          "intra_community_vat_ids",
          "An intra-community supply (category K) needs your USt-IdNr and the customer's VAT ID. [BR-IC-02]",
        ),
      );
    }
    if (doc.intraCommunity && !data.service_date && !data.service_period) {
      issues.push(
        error(
          "intra_community_delivery",
          "An intra-community supply (category K) needs a service date or period. The customer's address is sent as the delivery address. [BR-IC-11]",
        ),
      );
    }
    if (Math.abs(doc.grandTotal - Math.abs(data.total)) > 0.01) {
      issues.push(
        error(
          "en16931_totals",
          "The stored totals do not add up as EN 16931 requires (VAT on a discount). Open the invoice and save it again to recalculate.",
        ),
      );
    }
  }
  return issues;
}

/** XRechnung 3.0 (CIUS) requirements on top of EN 16931. */
function xrechnungChecks(data: XmlInvoiceData): EinvoiceIssue[] {
  const issues: EinvoiceIssue[] = [];
  const s = data.supplier;
  const c = data.customer;
  if (!s.city || !s.postal_code) {
    issues.push(
      error(
        "xr_seller_city_postcode",
        "XRechnung needs your postcode and city (Settings → E-invoicing). [BR-DE-3, BR-DE-4]",
      ),
    );
  }
  if (!s.phone) {
    issues.push(
      error("xr_seller_phone", "XRechnung needs your phone number (Settings). [BR-DE-6]"),
    );
  }
  if (!s.email) {
    issues.push(
      error("xr_seller_email", "XRechnung needs your email address (Settings). [BR-DE-7]"),
    );
  }
  if (!c.city || !c.postal_code) {
    issues.push(
      error(
        "xr_buyer_city_postcode",
        "XRechnung needs the customer's postcode and city. [BR-DE-8, BR-DE-9]",
      ),
    );
  }
  if (!c.leitweg_id && !c.einvoice_receiver_id && !c.email) {
    issues.push(
      error(
        "xr_buyer_address",
        "XRechnung needs the customer's Leitweg-ID or email address. [PEPPOL-EN16931-R010]",
      ),
    );
  }
  return issues;
}

function error(code: string, message: string, params?: Record<string, string>): EinvoiceIssue {
  return { severity: "error", code, message, ...(params && { params }) };
}

function warning(code: string, message: string, params?: Record<string, string>): EinvoiceIssue {
  return { severity: "warning", code, message, ...(params && { params }) };
}
