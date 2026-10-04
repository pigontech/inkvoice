import { isSepaIban, isValidBic, normalizeBic, normalizeIban } from "../utils/epc-qr";
import type { XmlInvoiceData } from "./types";

// EN 16931 semantics shared by the XRechnung (UBL) and ZUGFeRD (CII) profiles,
// so both syntaxes emit the same VAT categories, totals and party data.

export function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function amt(n: number): string {
  return n.toFixed(2);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Inkvoice stores credit notes with negative prices and totals. In EN 16931
 * the document type (381) carries the sign and amounts are positive (BR-27
 * forbids negative item prices), so a negative credit note is mirrored.
 */
export function forEmission(data: XmlInvoiceData): XmlInvoiceData {
  if (data.type !== "credit_note" || data.total >= 0) return data;
  const neg = (n: number) => (n === 0 ? 0 : -n);
  return {
    ...data,
    subtotal: neg(data.subtotal),
    tax_total: neg(data.tax_total),
    discount_amount: Math.abs(data.discount_amount),
    total: neg(data.total),
    items: data.items.map((i) => ({
      ...i,
      unit_price: neg(i.unit_price),
      line_total: neg(i.line_total),
      tax_amount: neg(i.tax_amount),
    })),
    tax_breakdown: data.tax_breakdown.map((t) => ({
      ...t,
      taxable_amount: neg(t.taxable_amount),
      tax_amount: neg(t.tax_amount),
    })),
  };
}

/** EN 16931 VAT category codes (UNTDID 5305 subset). */
const VAT_CATEGORIES = new Set(["S", "Z", "E", "AE", "K", "G", "O", "L", "M"]);

const FRANCHISE_FR_REASON = "TVA non applicable, art. 293 B du CGI";
const KLEINUNTERNEHMER_REASON =
  "Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG";

/**
 * Resolves the EN 16931 VAT category for a rate/category pair. "AA" (reduced
 * rate) is not part of the EN 16931 code list: every non-zero rate, reduced
 * or not, is category "S".
 */
export function vatCategory(
  code: string | null | undefined,
  rate: number,
  data: XmlInvoiceData,
): string {
  if (data.kleinunternehmer) return "E";
  if (data.franchise_fr && rate === 0) return "E";
  const c = (code || "").toUpperCase();
  if (c === "AA") return "S";
  if (VAT_CATEGORIES.has(c)) return c;
  return rate === 0 ? "Z" : "S";
}

/** Exemption reason text (BT-120), mandatory for categories E, AE, K, G and O. */
export function exemptionReason(category: string, data: XmlInvoiceData): string | null {
  switch (category) {
    case "E":
      if (data.kleinunternehmer) return KLEINUNTERNEHMER_REASON;
      if (data.franchise_fr) return FRANCHISE_FR_REASON;
      return "Steuerbefreite Leistung";
    case "AE":
      return "Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)";
    case "K":
      return "Steuerfreie innergemeinschaftliche Lieferung";
    case "G":
      return "Steuerfreie Ausfuhrlieferung";
    case "O":
      return "Nicht im Inland steuerbare Leistung";
    default:
      return null;
  }
}

/** Category "O" (not subject to VAT) must not carry a rate; all others must. */
export function hasPercent(category: string): boolean {
  return category !== "O";
}

/** Rate as emitted: categories other than S/Z with a rate are exempt, i.e. 0. */
export function vatRate(category: string, rate: number): number {
  return category === "S" ? rate : 0;
}

export interface VatGroup {
  category: string;
  rate: number;
  /** Sum of the line net amounts in this group (before document discount). */
  lineNet: number;
  /** Share of the document-level discount allocated to this group. */
  allowance: number;
  /** BT-116: lineNet - allowance. */
  taxable: number;
  /** BT-117. */
  tax: number;
  reason: string | null;
}

/**
 * VAT breakdown (BG-23). EN 16931 needs the document discount as one
 * allowance per VAT category, so it is split across the groups in proportion
 * to their line net; the last group takes the rounding remainder.
 */
export function vatGroups(data: XmlInvoiceData): VatGroup[] {
  const groups = new Map<string, VatGroup>();
  const keyOf = (category: string, rate: number) => `${category}|${rate}`;

  for (const item of data.items) {
    const category = vatCategory(item.tax_category_code, item.tax_rate, data);
    const rate = vatRate(category, item.tax_rate);
    const key = keyOf(category, rate);
    const g = groups.get(key) ?? {
      category,
      rate,
      lineNet: 0,
      allowance: 0,
      taxable: 0,
      tax: 0,
      reason: exemptionReason(category, data),
    };
    g.lineNet = round2(g.lineNet + item.line_total);
    groups.set(key, g);
  }

  for (const t of data.tax_breakdown) {
    const category = vatCategory(t.category_code, t.tax_rate, data);
    const g = groups.get(keyOf(category, vatRate(category, t.tax_rate)));
    if (g) g.tax = round2(g.tax + t.tax_amount);
  }

  const list = Array.from(groups.values());
  const totalNet = list.reduce((s, g) => s + g.lineNet, 0);
  let remaining = round2(data.discount_amount);
  list.forEach((g, i) => {
    const share =
      i === list.length - 1 || totalNet === 0
        ? remaining
        : round2((data.discount_amount * g.lineNet) / totalNet);
    g.allowance = data.discount_amount > 0 ? share : 0;
    remaining = round2(remaining - g.allowance);
    g.taxable = round2(g.lineNet - g.allowance);
  });
  return list;
}

export interface DocumentTotals {
  lineTotal: number;
  allowanceTotal: number;
  taxBasis: number;
  taxTotal: number;
  grandTotal: number;
}

/** BG-22 totals derived from the lines and groups so they always reconcile. */
export function documentTotals(data: XmlInvoiceData, groups: VatGroup[]): DocumentTotals {
  const lineTotal = round2(data.items.reduce((s, i) => s + i.line_total, 0));
  const allowanceTotal = round2(groups.reduce((s, g) => s + g.allowance, 0));
  const taxBasis = round2(lineTotal - allowanceTotal);
  const taxTotal = round2(groups.reduce((s, g) => s + g.tax, 0));
  return { lineTotal, allowanceTotal, taxBasis, taxTotal, grandTotal: round2(taxBasis + taxTotal) };
}

/** UN/ECE Recommendation 20 unit codes (BT-130). */
export function unitCode(unit: string): string {
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

export interface BankAccount {
  iban: string;
  bic: string | null;
  holder: string;
}

/**
 * Payee account (BG-17). The structured IBAN/BIC settings are validated when
 * saved; without them, a checksum-valid IBAN in the free-text bank details is
 * used, so random text is never emitted as an account number.
 */
export function payeeAccount(supplier: XmlInvoiceData["supplier"]): BankAccount | null {
  const holder = supplier.account_holder || supplier.name;
  const bicOf = (bic: string | null | undefined) =>
    bic && isValidBic(bic) ? normalizeBic(bic) : null;

  if (supplier.iban) {
    return { iban: normalizeIban(supplier.iban), bic: bicOf(supplier.bic), holder };
  }
  if (!supplier.bank_details) return null;
  const text = supplier.bank_details.toUpperCase();
  for (const m of text.matchAll(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g)) {
    const iban = normalizeIban(m[0]);
    if (isSepaIban(iban)) {
      const bic = text.match(/\b(?:BIC|SWIFT)\b[\s:.-]*([A-Z0-9]{8}(?:[A-Z0-9]{3})?)\b/);
      return { iban, bic: bicOf(bic?.[1]), holder };
    }
  }
  return null;
}

/** BT-41: the configured contact person, otherwise the company name. */
export function sellerContactName(data: XmlInvoiceData): string {
  return data.supplier.contact_name || data.supplier.name;
}

/** BT-10. XRechnung requires it: the Leitweg-ID for B2G, else the invoice number. */
export function buyerReference(data: XmlInvoiceData): string {
  return data.customer.leitweg_id || data.invoice_number;
}

export interface ElectronicAddress {
  scheme: string;
  id: string;
}

/** BT-34: configured PEPPOL id, otherwise the company email (scheme "EM"). */
export function sellerElectronicAddress(data: XmlInvoiceData): ElectronicAddress | null {
  if (data.supplier.peppol_endpoint_id) {
    return {
      scheme: data.supplier.peppol_scheme_id || "0208",
      id: data.supplier.peppol_endpoint_id,
    };
  }
  if (data.supplier.email) return { scheme: "EM", id: data.supplier.email };
  return null;
}

/** BT-49: Leitweg-ID, configured receiver id, otherwise the customer email. */
export function buyerElectronicAddress(data: XmlInvoiceData): ElectronicAddress | null {
  if (data.customer.leitweg_id) return { scheme: "0204", id: data.customer.leitweg_id };
  if (data.customer.einvoice_receiver_id) {
    return {
      scheme: data.customer.einvoice_receiver_scheme || "0088",
      id: data.customer.einvoice_receiver_id,
    };
  }
  if (data.customer.email) return { scheme: "EM", id: data.customer.email };
  return null;
}
