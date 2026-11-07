import { allocateProportionally } from "../utils/tax-calculator";
import type { XmlInvoiceData } from "./types";

// Shared EN 16931 view of an invoice for the XRechnung (UBL) and
// ZUGFeRD/Factur-X (CII) profiles. It turns the app's stored numbers into what
// the standard expects:
// - credit notes carry positive amounts (the type code 381 says "credit"),
//   while the app stores them negative;
// - item net prices are never negative (BR-27): a negative line becomes a
//   negative quantity at a positive price;
// - VAT categories use the EN 16931 code list (no "AA"; 0 % "S" is "Z");
// - a document discount is split per VAT category so each VAT breakdown's
//   taxable amount is lines minus allowances (BR-S-08 and friends);
// - exempt and reverse-charge categories carry an exemption reason (BR-E-10…).

const VAT_CATEGORIES = new Set(["S", "Z", "E", "AE", "K", "G", "O", "L", "M"]);

export interface En16931Line {
  index: number;
  name: string;
  /** May be negative (a negative line), the price never is. */
  quantity: number;
  unit: string;
  price: number;
  net: number;
  category: string;
  rate: number;
}

export interface En16931VatGroup {
  category: string;
  rate: number;
  /** Sum of the line net amounts in this group. */
  net: number;
  /** Document level allowance on this group (negative means a charge). */
  allowance: number;
  taxable: number;
  tax: number;
  exemptionReason: string | null;
  exemptionCode: string | null;
}

export interface En16931Doc {
  credit: boolean;
  lines: En16931Line[];
  groups: En16931VatGroup[];
  notes: string[];
  lineTotal: number;
  allowanceTotal: number;
  chargeTotal: number;
  taxBasis: number;
  taxTotal: number;
  grandTotal: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** EN 16931 VAT category for a line (or a stored breakdown entry). */
export function en16931Category(
  code: string | null | undefined,
  rate: number,
  data: Pick<XmlInvoiceData, "kleinunternehmer" | "franchise_fr">,
): string {
  let c = (code || "").trim().toUpperCase();
  // "AA" (lower rate) is in UNCL 5305 but not in the EN 16931 subset: a
  // German 7 % line is standard rated at 7 %.
  if (c === "AA") c = "S";
  if (!VAT_CATEGORIES.has(c)) c = rate === 0 ? "Z" : "S";
  if (c === "S" && rate === 0) c = "Z";
  // Kleinunternehmer (§ 19 UStG) and the French franchise en base sell VAT
  // exempt; their 0 % lines are category E with an exemption reason.
  if (rate === 0 && (data.kleinunternehmer || data.franchise_fr) && (c === "Z" || c === "E")) {
    c = "E";
  }
  return c;
}

const REASONS_DE: Record<string, [string, string]> = {
  AE: ["VATEX-EU-AE", "Steuerschuldnerschaft des Leistungsempfängers"],
  K: ["VATEX-EU-IC", "Steuerfreie innergemeinschaftliche Lieferung"],
  G: ["VATEX-EU-G", "Steuerfreie Ausfuhrlieferung"],
  O: ["VATEX-EU-O", "Nicht im Inland steuerbare Leistung"],
};
const REASONS_EN: Record<string, [string, string]> = {
  AE: ["VATEX-EU-AE", "Reverse charge"],
  K: ["VATEX-EU-IC", "Intra-community supply"],
  G: ["VATEX-EU-G", "Export outside the EU"],
  O: ["VATEX-EU-O", "Not subject to VAT"],
};

function exemption(
  category: string,
  taxName: string | null | undefined,
  data: XmlInvoiceData,
): { reason: string | null; code: string | null } {
  if (category === "E") {
    if (data.franchise_fr) return { reason: "TVA non applicable, art. 293 B du CGI", code: null };
    if (data.kleinunternehmer) return { reason: "Kleinunternehmer gemäß § 19 UStG", code: null };
    return { reason: taxName?.trim() || "Steuerbefreit", code: null };
  }
  const table = (data.supplier.country || "").toUpperCase() === "DE" ? REASONS_DE : REASONS_EN;
  const hit = table[category];
  return hit ? { code: hit[0], reason: hit[1] } : { reason: null, code: null };
}

export function prepareEn16931(data: XmlInvoiceData): En16931Doc {
  const credit = data.type === "credit_note";
  // The app stores credit notes with negative prices and totals.
  const sign = credit && data.total < 0 ? -1 : 1;

  const lines: En16931Line[] = data.items.map((item, i) => {
    let quantity = item.quantity;
    let price = item.unit_price * sign;
    if (price < 0) {
      price = -price;
      quantity = -quantity;
    }
    return {
      index: i + 1,
      name: item.description,
      quantity,
      unit: item.unit,
      price,
      net: round2(item.line_total * sign),
      category: en16931Category(item.tax_category_code, item.tax_rate, data),
      rate: item.tax_rate,
    };
  });

  // VAT groups by (category, rate), in first-seen order.
  const groups: En16931VatGroup[] = [];
  const lineTax = new Map<En16931VatGroup, number>();
  data.items.forEach((item, i) => {
    const line = lines[i];
    let group = groups.find((g) => g.category === line.category && g.rate === line.rate);
    if (!group) {
      const ex = exemption(line.category, item.tax_name, data);
      group = {
        category: line.category,
        rate: line.rate,
        net: 0,
        allowance: 0,
        taxable: 0,
        tax: 0,
        exemptionReason: ex.reason,
        exemptionCode: ex.code,
      };
      groups.push(group);
    }
    group.net = round2(group.net + line.net);
    lineTax.set(group, (lineTax.get(group) ?? 0) + item.tax_amount * sign);
  });

  // Split the document discount by rate (as the calculator does), then by
  // category within a rate.
  const discount = round2(data.discount_amount * sign);
  const rates = Array.from(new Set(groups.map((g) => g.rate)));
  const rateShares = allocateProportionally(
    discount,
    rates.map((r) => round2(groups.filter((g) => g.rate === r).reduce((s, g) => s + g.net, 0))),
  );
  rates.forEach((rate, i) => {
    const inRate = groups.filter((g) => g.rate === rate);
    const shares = allocateProportionally(
      rateShares[i],
      inRate.map((g) => g.net),
    );
    inRate.forEach((g, j) => {
      g.allowance = shares[j];
      g.taxable = round2(g.net - g.allowance);
      g.tax = round2((lineTax.get(g) ?? 0) - round2(g.allowance * (g.rate / 100)));
    });
  });

  // Keep the XML's VAT total equal to the stored invoice total. Per-group
  // rounding can differ from the stored total by a cent or two; EN 16931
  // allows each group's VAT to deviate by less than one unit (BR-CO-17).
  const storedTax = round2(data.tax_total * sign);
  const residue = round2(storedTax - groups.reduce((s, g) => s + g.tax, 0));
  if (residue !== 0 && Math.abs(residue) <= 0.05 && groups.length > 0) {
    const target = groups.reduce((a, b) => (Math.abs(b.tax) > Math.abs(a.tax) ? b : a));
    target.tax = round2(target.tax + residue);
  }

  const lineTotal = round2(lines.reduce((s, l) => s + l.net, 0));
  const allowanceTotal = round2(groups.reduce((s, g) => s + Math.max(g.allowance, 0), 0));
  const chargeTotal = round2(groups.reduce((s, g) => s + Math.max(-g.allowance, 0), 0));
  const taxBasis = round2(lineTotal - allowanceTotal + chargeTotal);
  const taxTotal = round2(groups.reduce((s, g) => s + g.tax, 0));
  const grandTotal = round2(taxBasis + taxTotal);

  const notes: string[] = [];
  if (data.notes) notes.push(data.notes);
  if (data.kleinunternehmer) notes.push("Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.");
  if (groups.some((g) => g.category === "AE")) {
    notes.push("Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge).");
  }

  return {
    credit,
    lines,
    groups,
    notes,
    lineTotal,
    allowanceTotal,
    chargeTotal,
    taxBasis,
    taxTotal,
    grandTotal,
  };
}

/** Amounts: two decimals. */
export function amt(n: number): string {
  return round2(n).toFixed(2);
}

/** Prices and quantities: up to four decimals, at least two for prices. */
export function decimal(n: number, minDecimals = 0): string {
  const fixed = (Math.round(n * 10000) / 10000).toFixed(4);
  const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  const [, frac = ""] = trimmed.split(".");
  return frac.length >= minDecimals ? trimmed : Number(trimmed).toFixed(minDecimals);
}

/** Percent without trailing zeros (19, 7, 0, 5.5). */
export function percent(rate: number): string {
  return decimal(rate);
}

export function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** IBAN without spaces, upper case. */
export function cleanIban(iban: string | null | undefined): string {
  return (iban || "").replace(/\s+/g, "").toUpperCase();
}
