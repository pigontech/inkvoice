import { describe, expect, test } from "bun:test";
import {
  calculateInvoiceTotals,
  calculateInvoiceTotalsMultiTax,
  calculateLineItem,
  calculateLineItemMultiTax,
  calculateLineItemMultiTaxInclusive,
  calculateLineItemTaxInclusive,
} from "../utils/tax-calculator";

describe("calculateLineItem", () => {
  test("basic calculation", () => {
    const result = calculateLineItem({ quantity: 2, unit_price: 100, tax_rate: 10 });
    expect(result.line_total).toBe(200);
    expect(result.tax_amount).toBe(20);
  });

  test("zero quantity", () => {
    const result = calculateLineItem({ quantity: 0, unit_price: 100, tax_rate: 10 });
    expect(result.line_total).toBe(0);
    expect(result.tax_amount).toBe(0);
  });

  test("zero tax rate", () => {
    const result = calculateLineItem({ quantity: 3, unit_price: 50, tax_rate: 0 });
    expect(result.line_total).toBe(150);
    expect(result.tax_amount).toBe(0);
  });

  test("rounds to 2 decimal places", () => {
    const result = calculateLineItem({ quantity: 3, unit_price: 10.33, tax_rate: 7.5 });
    expect(result.line_total).toBe(30.99);
    expect(result.tax_amount).toBe(2.32);
  });

  test("fractional quantity", () => {
    const result = calculateLineItem({ quantity: 1.5, unit_price: 100, tax_rate: 20 });
    expect(result.line_total).toBe(150);
    expect(result.tax_amount).toBe(30);
  });
});

describe("calculateInvoiceTotals", () => {
  test("single item no discount", () => {
    const items = [{ quantity: 1, unit_price: 100, tax_rate: 10 }];
    const result = calculateInvoiceTotals(items);
    expect(result.subtotal).toBe(100);
    expect(result.tax_total).toBe(10);
    expect(result.discount_amount).toBe(0);
    expect(result.total).toBe(110);
  });

  test("multiple items", () => {
    const items = [
      { quantity: 1, unit_price: 100, tax_rate: 10 },
      { quantity: 2, unit_price: 50, tax_rate: 0 },
    ];
    const result = calculateInvoiceTotals(items);
    expect(result.subtotal).toBe(200);
    expect(result.tax_total).toBe(10);
    expect(result.total).toBe(210);
  });

  test("percentage discount", () => {
    const items = [{ quantity: 1, unit_price: 100, tax_rate: 10 }];
    const result = calculateInvoiceTotals(items, "percentage", 10);
    expect(result.subtotal).toBe(100);
    expect(result.discount_amount).toBe(10);
    expect(result.tax_total).toBe(10);
    expect(result.total).toBe(100); // 100 - 10 + 10
  });

  test("fixed discount", () => {
    const items = [{ quantity: 1, unit_price: 100, tax_rate: 0 }];
    const result = calculateInvoiceTotals(items, "amount", 25);
    expect(result.discount_amount).toBe(25);
    expect(result.total).toBe(75);
  });

  test("discount capped at subtotal (percentage)", () => {
    const items = [{ quantity: 1, unit_price: 100, tax_rate: 0 }];
    const result = calculateInvoiceTotals(items, "percentage", 200);
    expect(result.discount_amount).toBe(100);
    expect(result.total).toBe(0);
  });

  test("discount capped at subtotal (fixed)", () => {
    const items = [{ quantity: 1, unit_price: 50, tax_rate: 0 }];
    const result = calculateInvoiceTotals(items, "amount", 999);
    expect(result.discount_amount).toBe(50);
    expect(result.total).toBe(0);
  });

  test("empty items", () => {
    const result = calculateInvoiceTotals([]);
    expect(result.subtotal).toBe(0);
    expect(result.total).toBe(0);
  });

  test("no discount type ignores discount value", () => {
    const items = [{ quantity: 1, unit_price: 100, tax_rate: 0 }];
    const result = calculateInvoiceTotals(items, null, 50);
    expect(result.discount_amount).toBe(0);
    expect(result.total).toBe(100);
  });
});

describe("calculateLineItemTaxInclusive", () => {
  test("extracts 20% VAT from gross price", () => {
    // 120 gross at 20% → net 100, tax 20
    const result = calculateLineItemTaxInclusive({ quantity: 1, unit_price: 120, tax_rate: 20 });
    expect(result.line_total).toBe(100);
    expect(result.tax_amount).toBe(20);
  });

  test("zero-rate inclusive returns gross unchanged", () => {
    const result = calculateLineItemTaxInclusive({ quantity: 2, unit_price: 50, tax_rate: 0 });
    expect(result.line_total).toBe(100);
    expect(result.tax_amount).toBe(0);
  });

  test("rounds inclusive split to 2dp", () => {
    // 33.33 gross at 7%: net = 31.15 (after rounding), tax = 2.18
    const result = calculateLineItemTaxInclusive({ quantity: 1, unit_price: 33.33, tax_rate: 7 });
    expect(result.line_total + result.tax_amount).toBeCloseTo(33.33, 2);
  });
});

describe("calculateInvoiceTotals (inclusive mode + rounding modes)", () => {
  test("pricesIncludeTax=true treats unit_price as gross", () => {
    const items = [{ quantity: 1, unit_price: 120, tax_rate: 20 }];
    const result = calculateInvoiceTotals(items, undefined, undefined, { pricesIncludeTax: true });
    expect(result.subtotal).toBe(100);
    expect(result.tax_total).toBe(20);
    expect(result.total).toBe(120);
  });

  test("roundingMode=total accumulates unrounded then rounds at the end", () => {
    // 3 lines × 0.33 unit_price × 7.5%: rounded-per-line each yields 0.02 (3×0.02=0.06),
    // unrounded total: 0.33×0.075×3 = 0.07425 → rounds to 0.07.
    const items = [
      { quantity: 1, unit_price: 0.33, tax_rate: 7.5 },
      { quantity: 1, unit_price: 0.33, tax_rate: 7.5 },
      { quantity: 1, unit_price: 0.33, tax_rate: 7.5 },
    ];
    const lineMode = calculateInvoiceTotals(items, undefined, undefined, { roundingMode: "line" });
    const totalMode = calculateInvoiceTotals(items, undefined, undefined, {
      roundingMode: "total",
    });
    // The two rounding strategies should produce subtly different tax totals
    // when penny-rounding accumulates.
    expect(lineMode.tax_total).not.toBe(totalMode.tax_total);
  });

  test("inclusive mode + percentage discount", () => {
    // 110 gross at 10% inclusive → net 100, tax 10. 10% discount on 100 = 10.
    // Total = 100 - 10 + 10 = 100.
    const items = [{ quantity: 1, unit_price: 110, tax_rate: 10 }];
    const result = calculateInvoiceTotals(items, "percentage", 10, { pricesIncludeTax: true });
    expect(result.subtotal).toBe(100);
    expect(result.discount_amount).toBe(10);
    expect(result.tax_total).toBe(10);
    expect(result.total).toBe(100);
  });
});

describe("multi-tax calculations", () => {
  test("calculateLineItemMultiTax sums multiple tax rates", () => {
    // 100 base, 10% + 5% = 15% total tax
    const result = calculateLineItemMultiTax({
      quantity: 1,
      unit_price: 100,
      tax_rates: [10, 5],
    });
    expect(result.line_total).toBe(100);
    expect(result.tax_amounts).toEqual([10, 5]);
    expect(result.total_tax).toBe(15);
  });

  test("calculateLineItemMultiTaxInclusive splits gross across rates", () => {
    // Gross 115 with rates [10, 5] (combined 15%) → net 100
    const result = calculateLineItemMultiTaxInclusive({
      quantity: 1,
      unit_price: 115,
      tax_rates: [10, 5],
    });
    expect(result.line_total).toBe(100);
    expect(result.total_tax).toBeCloseTo(15, 1);
  });

  test("calculateInvoiceTotalsMultiTax aggregates across items", () => {
    const items = [
      { quantity: 1, unit_price: 100, tax_rates: [10] },
      { quantity: 2, unit_price: 50, tax_rates: [5, 5] },
    ];
    const result = calculateInvoiceTotalsMultiTax(items);
    expect(result.subtotal).toBe(200);
    // 100*10% + 100*10% (the 5+5 on the second item)
    expect(result.tax_total).toBe(20);
    expect(result.total).toBe(220);
  });
});
