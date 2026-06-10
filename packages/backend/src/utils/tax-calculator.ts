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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calculateLineItem(item: LineItemInput): CalculatedLineItem {
  const lineTotal = round2(item.quantity * item.unit_price);
  const taxAmount = round2(lineTotal * (item.tax_rate / 100));
  return { line_total: lineTotal, tax_amount: taxAmount };
}

export function calculateLineItemTaxInclusive(item: LineItemInput): CalculatedLineItem {
  const gross = round2(item.quantity * item.unit_price);
  const rate = item.tax_rate / 100;
  const net = round2(gross / (1 + rate));
  const taxAmount = round2(gross - net);
  return { line_total: net, tax_amount: taxAmount };
}

export function calculateLineItemMultiTax(item: MultiTaxLineItemInput): CalculatedMultiTaxLineItem {
  const lineTotal = round2(item.quantity * item.unit_price);
  const taxAmounts = item.tax_rates.map((rate) => round2(lineTotal * (rate / 100)));
  const totalTax = round2(taxAmounts.reduce((sum, a) => sum + a, 0));
  return { line_total: lineTotal, tax_amounts: taxAmounts, total_tax: totalTax };
}

export function calculateLineItemMultiTaxInclusive(
  item: MultiTaxLineItemInput,
): CalculatedMultiTaxLineItem {
  const gross = round2(item.quantity * item.unit_price);
  const combinedRate = item.tax_rates.reduce((sum, r) => sum + r, 0) / 100;
  const net = round2(gross / (1 + combinedRate));
  // Distribute tax proportionally across rates
  const taxAmounts = item.tax_rates.map((rate) => round2(net * (rate / 100)));
  const totalTax = round2(taxAmounts.reduce((sum, a) => sum + a, 0));
  return { line_total: net, tax_amounts: taxAmounts, total_tax: totalTax };
}

export function calculateInvoiceTotals(
  items: LineItemInput[],
  discountType?: string | null,
  discountValue?: number,
  options?: { roundingMode?: RoundingMode; pricesIncludeTax?: boolean },
): InvoiceTotals {
  const roundingMode = options?.roundingMode ?? "line";
  const pricesIncludeTax = options?.pricesIncludeTax ?? false;

  let subtotal = 0;
  let taxTotal = 0;

  for (const item of items) {
    if (pricesIncludeTax) {
      const calc = calculateLineItemTaxInclusive(item);
      subtotal += calc.line_total;
      if (roundingMode === "line") {
        taxTotal += calc.tax_amount;
      } else {
        // Accumulate unrounded for "total" rounding mode
        const gross = round2(item.quantity * item.unit_price);
        const rate = item.tax_rate / 100;
        const net = gross / (1 + rate);
        taxTotal += gross - net;
      }
    } else {
      const calc = calculateLineItem(item);
      subtotal += calc.line_total;
      if (roundingMode === "line") {
        taxTotal += calc.tax_amount;
      } else {
        // Accumulate unrounded
        const lineTotal = item.quantity * item.unit_price;
        taxTotal += lineTotal * (item.tax_rate / 100);
      }
    }
  }

  subtotal = round2(subtotal);
  taxTotal = round2(taxTotal);

  let discountAmount = 0;
  if (discountType === "percentage" && discountValue) {
    discountAmount = round2(subtotal * (Math.min(discountValue, 100) / 100));
  } else if (discountType === "amount" && discountValue) {
    discountAmount = round2(Math.min(discountValue, subtotal));
  }

  const total = round2(subtotal - discountAmount + taxTotal);

  return { subtotal, tax_total: taxTotal, discount_amount: discountAmount, total };
}

export function calculateInvoiceTotalsMultiTax(
  items: MultiTaxLineItemInput[],
  discountType?: string | null,
  discountValue?: number,
  options?: { roundingMode?: RoundingMode; pricesIncludeTax?: boolean },
): InvoiceTotals {
  const roundingMode = options?.roundingMode ?? "line";
  const pricesIncludeTax = options?.pricesIncludeTax ?? false;

  let subtotal = 0;
  let taxTotal = 0;

  for (const item of items) {
    if (pricesIncludeTax) {
      const calc = calculateLineItemMultiTaxInclusive(item);
      subtotal += calc.line_total;
      if (roundingMode === "line") {
        taxTotal += calc.total_tax;
      } else {
        const gross = round2(item.quantity * item.unit_price);
        const combinedRate = item.tax_rates.reduce((sum, r) => sum + r, 0) / 100;
        const net = gross / (1 + combinedRate);
        taxTotal += gross - net;
      }
    } else {
      const calc = calculateLineItemMultiTax(item);
      subtotal += calc.line_total;
      if (roundingMode === "line") {
        taxTotal += calc.total_tax;
      } else {
        const lineTotal = item.quantity * item.unit_price;
        taxTotal += item.tax_rates.reduce((sum, r) => sum + lineTotal * (r / 100), 0);
      }
    }
  }

  subtotal = round2(subtotal);
  taxTotal = round2(taxTotal);

  let discountAmount = 0;
  if (discountType === "percentage" && discountValue) {
    discountAmount = round2(subtotal * (Math.min(discountValue, 100) / 100));
  } else if (discountType === "amount" && discountValue) {
    discountAmount = round2(Math.min(discountValue, subtotal));
  }

  const total = round2(subtotal - discountAmount + taxTotal);

  return { subtotal, tax_total: taxTotal, discount_amount: discountAmount, total };
}
