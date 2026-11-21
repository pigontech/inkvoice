/** Statuses of issued invoices that still have something left to pay. */
const OPEN_STATUSES = new Set(["sent", "partially_paid", "overdue"]);

interface InvoiceBalance {
  status: string;
  total: number;
  amount_paid?: number | null;
}

/**
 * What is still due on a list of invoices: total - amount_paid over sent,
 * partially paid and overdue invoices. Payments already received on an
 * invoice are not counted again.
 */
export function sumOutstanding(invoices: InvoiceBalance[]): number {
  return invoices
    .filter((inv) => OPEN_STATUSES.has(inv.status))
    .reduce((sum, inv) => sum + inv.total - (inv.amount_paid || 0), 0);
}
