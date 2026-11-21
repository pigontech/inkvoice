// The Outstanding card on a customer's page sums what is still due on their
// invoices.

import { describe, expect, test } from "bun:test";
import { sumOutstanding } from "@/lib/outstanding";

describe("sumOutstanding", () => {
  test("counts the unpaid balance of sent, partially paid and overdue invoices", () => {
    const invoices = [
      { status: "sent", total: 300, amount_paid: 0 },
      { status: "partially_paid", total: 1000, amount_paid: 400 },
      { status: "overdue", total: 500, amount_paid: 200 },
      { status: "paid", total: 250, amount_paid: 250 },
      { status: "draft", total: 700, amount_paid: 0 },
      { status: "voided", total: 400, amount_paid: 0 },
    ];
    expect(sumOutstanding(invoices)).toBeCloseTo(1200, 2);
  });

  test("treats a missing amount_paid as nothing paid", () => {
    expect(sumOutstanding([{ status: "sent", total: 120, amount_paid: null }])).toBe(120);
    expect(sumOutstanding([{ status: "overdue", total: 80 }])).toBe(80);
  });

  test("lets an issued credit note reduce the balance, as before", () => {
    const invoices = [
      { status: "sent", total: 300, amount_paid: 0 },
      { status: "sent", total: -100, amount_paid: 0 },
    ];
    expect(sumOutstanding(invoices)).toBe(200);
  });
});
