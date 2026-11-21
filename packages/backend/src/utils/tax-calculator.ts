import { roundMoney } from "./money";

interface LineItemInput {
  quantity: number;
  unit_price: number;
  tax_rate: number;
}

interface CalculatedLineItem {
  line_total: number;
  tax_amount: number;
}

interface MultiTaxLineItemInput {
  quantity: number;
  unit_price: number;
  tax_rates: number[];
}

interface CalculatedMultiTaxLineItem {
  line_total: number;
  tax_amounts: number[];
  total_tax: number;
}

interface InvoiceTotals {
  subtotal: number;
  tax_total: number;
  discount_amount: number;
  total: number;
}

type RoundingMode = "line" | "total";

export function calculateLineItem(item: LineItemInput, currency?: string): CalculatedLineItem {
  const round = (n: number) => roundMoney(n, currency);
  const lineTotal = round(item.quantity * item.unit_price);
  const taxAmount = round(lineTotal * (item.tax_rate / 100));
  return { line_total: lineTotal, tax_amount: taxAmount };
}

export function calculateLineItemTaxInclusive(
  item: LineItemInput,
  currency?: string,
): CalculatedLineItem {
  const round = (n: number) => roundMoney(n, currency);
  const gross = round(item.quantity * item.unit_price);
  const rate = item.tax_rate / 100;
  const net = round(gross / (1 + rate));
  const taxAmount = round(gross - net);
  return { line_total: net, tax_amount: taxAmount };
}

export function calculateLineItemMultiTax(
  item: MultiTaxLineItemInput,
  currency?: string,
): CalculatedMultiTaxLineItem {
  const round = (n: number) => roundMoney(n, currency);
  const lineTotal = round(item.quantity * item.unit_price);
  const taxAmounts = item.tax_rates.map((rate) => round(lineTotal * (rate / 100)));
  const totalTax = round(taxAmounts.reduce((sum, a) => sum + a, 0));
  return { line_total: lineTotal, tax_amounts: taxAmounts, total_tax: totalTax };
}

export function calculateLineItemMultiTaxInclusive(
  item: MultiTaxLineItemInput,
  currency?: string,
): CalculatedMultiTaxLineItem {
  const round = (n: number) => roundMoney(n, currency);
  const gross = round(item.quantity * item.unit_price);
  const combinedRate = item.tax_rates.reduce((sum, r) => sum + r, 0) / 100;
  const net = round(gross / (1 + combinedRate));
  // Distribute tax proportionally across rates
  const taxAmounts = item.tax_rates.map((rate) => round(net * (rate / 100)));
  const totalTax = round(taxAmounts.reduce((sum, a) => sum + a, 0));
  return { line_total: net, tax_amounts: taxAmounts, total_tax: totalTax };
}

export function calculateInvoiceTotals(
  items: LineItemInput[],
  discountType?: string | null,
  discountValue?: number,
  options?: { roundingMode?: RoundingMode; pricesIncludeTax?: boolean; currency?: string },
): InvoiceTotals {
  const currency = options?.currency;
  const round = (n: number) => roundMoney(n, currency);
  const roundingMode = options?.roundingMode ?? "line";
  const pricesIncludeTax = options?.pricesIncludeTax ?? false;

  let subtotal = 0;
  let taxTotal = 0;
  // Net amount per VAT rate, in first-seen order, so a document discount can
  // be taken off each rate's taxable amount.
  const netByRate = new Map<number, number>();

  for (const item of items) {
    let lineNet: number;
    if (pricesIncludeTax) {
      const calc = calculateLineItemTaxInclusive(item, currency);
      lineNet = calc.line_total;
      subtotal += calc.line_total;
      if (roundingMode === "line") {
        taxTotal += calc.tax_amount;
      } else {
        // Accumulate unrounded for "total" rounding mode
        const gross = round(item.quantity * item.unit_price);
        const rate = item.tax_rate / 100;
        const net = gross / (1 + rate);
        taxTotal += gross - net;
      }
    } else {
      const calc = calculateLineItem(item, currency);
      lineNet = calc.line_total;
      subtotal += calc.line_total;
      if (roundingMode === "line") {
        taxTotal += calc.tax_amount;
      } else {
        // Accumulate unrounded
        const lineTotal = item.quantity * item.unit_price;
        taxTotal += lineTotal * (item.tax_rate / 100);
      }
    }
    netByRate.set(item.tax_rate, (netByRate.get(item.tax_rate) ?? 0) + lineNet);
  }

  subtotal = round(subtotal);

  let discountAmount = 0;
  if (discountType === "percentage" && discountValue) {
    discountAmount = round(subtotal * (Math.min(discountValue, 100) / 100));
  } else if (discountType === "amount" && discountValue) {
    // Capped at the size of the subtotal and signed like it, so a credit note
    // (negative lines) reverses a fixed discount instead of taking it again.
    const capped = Math.min(Math.abs(discountValue), Math.abs(subtotal));
    discountAmount = round(subtotal < 0 ? -capped : capped);
  }

  // A document discount lowers the taxable amount, so the VAT on each rate's
  // share of the discount comes off the tax total (EN 16931 BR-S-08/BR-CO-17).
  if (discountAmount !== 0) {
    const rates = Array.from(netByRate.keys());
    const shares = allocateProportionally(
      discountAmount,
      rates.map((r) => round(netByRate.get(r) ?? 0)),
      currency,
    );
    rates.forEach((rate, i) => {
      const discountTax = shares[i] * (rate / 100);
      taxTotal -= roundingMode === "line" ? round(discountTax) : discountTax;
    });
  }
  taxTotal = round(taxTotal);

  const total = round(subtotal - discountAmount + taxTotal);

  return { subtotal, tax_total: taxTotal, discount_amount: discountAmount, total };
}

export interface StoredTaxLine {
  line_total: number;
  tax_amount: number;
  tax_rate: number;
}

export interface RateTax {
  rate: number;
  /** Sum of line net amounts at this rate. */
  net: number;
  /** This rate's share of the document discount. */
  discount: number;
  /** VAT at this rate after the discount. */
  tax: number;
}

/**
 * VAT per rate for stored line items, with the document discount taken off
 * each rate's base the same way calculateInvoiceTotals does it. Rates come out
 * in first-seen order.
 */
export function taxByRate(
  lines: StoredTaxLine[],
  discountAmount: number,
  currency?: string,
): RateTax[] {
  const round = (n: number) => roundMoney(n, currency);
  const byRate = new Map<number, { net: number; tax: number }>();
  for (const line of lines) {
    const entry = byRate.get(line.tax_rate) ?? { net: 0, tax: 0 };
    entry.net += line.line_total;
    entry.tax += line.tax_amount;
    byRate.set(line.tax_rate, entry);
  }
  const rates = Array.from(byRate.keys());
  const nets = rates.map((r) => round(byRate.get(r)?.net ?? 0));
  const shares = allocateProportionally(discountAmount, nets, currency);
  return rates.map((rate, i) => ({
    rate,
    net: nets[i],
    discount: shares[i],
    tax: round((byRate.get(rate)?.tax ?? 0) - round(shares[i] * (rate / 100))),
  }));
}

/**
 * Splits `amount` across `bases` in proportion, rounded to the currency's
 * minor unit, so the shares add up to `amount` exactly (the rounding residue
 * goes to the largest base). Used for document discounts per VAT rate.
 */
export function allocateProportionally(
  amount: number,
  bases: number[],
  currency?: string,
): number[] {
  const round = (n: number) => roundMoney(n, currency);
  const total = bases.reduce((sum, b) => sum + b, 0);
  if (!amount || !total || bases.length === 0) return bases.map(() => 0);
  const shares = bases.map((b) => round((amount * b) / total));
  const residue = round(amount - shares.reduce((sum, s) => sum + s, 0));
  if (residue !== 0) {
    let largest = 0;
    for (let i = 1; i < bases.length; i++) {
      if (Math.abs(bases[i]) > Math.abs(bases[largest])) largest = i;
    }
    shares[largest] = round(shares[largest] + residue);
  }
  return shares;
}
