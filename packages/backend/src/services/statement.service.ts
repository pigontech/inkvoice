import Mustache from "mustache";
import { getDb } from "../database/connection";
import type { Customer } from "../types/customer";
import { formatCurrency } from "../utils/currency";
import { todayIso } from "../utils/date";
import { getAllSettings } from "./settings.service";
import { STATEMENT_TEMPLATE } from "./statement-template";

// A customer account statement: opening balance, every charge/payment/credit
// over a date range with a running balance, a closing balance, and an aging
// summary footer. Amounts are consolidated into the business base currency
// using each document's frozen exchange_rate (= 1 for single-currency users),
// matching the multi-currency consolidated reporting.

export interface StatementLine {
  raw_date: string;
  date: string;
  reference: string;
  description: string;
  charge: string;
  credit: string;
  balance: string;
}

export interface StatementAgingBucket {
  label: string;
  amount: string;
  raw: number;
}

export interface StatementData {
  customer: {
    name: string;
    email: string | null;
    address: string;
    tax_id: string | null;
  };
  company: {
    name: string;
    email: string;
    phone: string;
    address: string;
    tax_id: string;
    logo: string;
  };
  period: { from: string; to: string };
  statement_date: string;
  currency: string;
  opening_balance: string;
  opening_balance_raw: number;
  closing_balance: string;
  closing_balance_raw: number;
  lines: StatementLine[];
  has_lines: boolean;
  aging: StatementAgingBucket[];
  aging_total: string;
  aging_total_raw: number;
  i18n: Record<string, string>;
}

interface DocRow {
  invoice_number: string;
  issue_date: string;
  total: number;
  exchange_rate: number | null;
  type: string | null;
}

interface PaymentRow {
  payment_date: string;
  amount: number;
  invoice_number: string;
  exchange_rate: number | null;
}

interface AgingRow {
  due_date: string | null;
  total: number;
  amount_paid: number;
  exchange_rate: number | null;
}

const LABELS: Record<"en" | "tr", Record<string, string>> = {
  en: {
    statement: "Statement",
    statement_date: "Statement date",
    period: "Period",
    bill_to: "Bill to",
    balance_due: "Balance due",
    date: "Date",
    reference: "Reference",
    description: "Description",
    charges: "Charges",
    payments_credits: "Payments / Credits",
    balance: "Balance",
    opening_balance: "Opening balance",
    closing_balance: "Closing balance",
    no_activity: "No activity in this period.",
    aging_summary: "Aging summary (outstanding)",
    total_due: "Total due",
    invoice: "Invoice",
    credit_note: "Credit note",
    payment: "Payment",
    current: "Current",
    footer_note:
      "This statement reflects activity for the selected period. Please contact us with any questions.",
  },
  tr: {
    statement: "Hesap Özeti",
    statement_date: "Özet tarihi",
    period: "Dönem",
    bill_to: "Müşteri",
    balance_due: "Bakiye",
    date: "Tarih",
    reference: "Referans",
    description: "Açıklama",
    charges: "Borç",
    payments_credits: "Ödeme / Alacak",
    balance: "Bakiye",
    opening_balance: "Açılış bakiyesi",
    closing_balance: "Kapanış bakiyesi",
    no_activity: "Bu dönemde hareket yok.",
    aging_summary: "Yaşlandırma özeti (açık bakiye)",
    total_due: "Toplam borç",
    invoice: "Fatura",
    credit_note: "İade faturası",
    payment: "Ödeme",
    current: "Güncel",
    footer_note:
      "Bu özet seçilen dönemdeki hareketleri gösterir. Sorularınız için bizimle iletişime geçin.",
  },
};

function formatDateStr(dateStr: string, dateFormat?: string, localeOverride?: string): string {
  const d = new Date(dateStr);
  if (dateFormat && !localeOverride) {
    const yyyy = d.getFullYear().toString();
    const mm = (d.getMonth() + 1).toString().padStart(2, "0");
    const dd = d.getDate().toString().padStart(2, "0");
    return dateFormat.replace("YYYY", yyyy).replace("MM", mm).replace("DD", dd);
  }
  return d.toLocaleDateString(localeOverride || "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function agingBuckets(rows: AgingRow[], asOf: string, labels: Record<string, string>) {
  const buckets = [
    { key: "current", label: labels.current, raw: 0 },
    { key: "1-30", label: "1–30", raw: 0 },
    { key: "31-60", label: "31–60", raw: 0 },
    { key: "61-90", label: "61–90", raw: 0 },
    { key: "90+", label: "90+", raw: 0 },
  ];
  const asOfMs = new Date(asOf).getTime();
  for (const r of rows) {
    const outstanding = (r.total - (r.amount_paid || 0)) * (r.exchange_rate || 1);
    if (outstanding <= 0) continue;
    const dueDate = r.due_date || asOf;
    const days = Math.floor((asOfMs - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24));
    const idx = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
    buckets[idx].raw += outstanding;
  }
  return buckets;
}

/**
 * Compute the full statement dataset for a customer over [from, to].
 * Returns null if the customer doesn't exist.
 */
export function buildStatementData(
  customerId: string,
  from: string,
  to: string,
): StatementData | null {
  const db = getDb();
  const customer = db
    .query("SELECT * FROM customers WHERE id = ?")
    .get(customerId) as Customer | null;
  if (!customer) return null;

  const settings = getAllSettings();
  const currency = settings.currency || "USD";
  const numberFormat = settings.number_format || undefined;
  const localeOverride = customer.language || settings.locale || undefined;
  const dateFormat = settings.date_format || undefined;
  const lang = (localeOverride || "en").toLowerCase().startsWith("tr") ? "tr" : "en";
  const labels = LABELS[lang];
  const fmt = (n: number) => formatCurrency(n, currency, numberFormat, localeOverride);
  const fdate = (d: string) => formatDateStr(d, dateFormat, localeOverride);

  // Documents (invoices + credit notes), excluding drafts and voided. Credit
  // notes carry a negative total, so a document's signed base contribution is
  // simply total * exchange_rate.
  const docs = db
    .query(
      `SELECT invoice_number, issue_date, total, exchange_rate, type
       FROM invoices
       WHERE customer_id = ? AND deleted_at IS NULL
         AND status NOT IN ('draft', 'voided')
       ORDER BY issue_date ASC, created_at ASC`,
    )
    .all(customerId) as DocRow[];

  const payments = db
    .query(
      `SELECT p.payment_date, p.amount, i.invoice_number, i.exchange_rate
       FROM payments p
       JOIN invoices i ON p.invoice_id = i.id
       WHERE i.customer_id = ? AND i.deleted_at IS NULL AND i.status != 'voided'
       ORDER BY p.payment_date ASC, p.created_at ASC`,
    )
    .all(customerId) as PaymentRow[];

  // Opening balance = everything dated strictly before `from`.
  let opening = 0;
  for (const d of docs) {
    if (d.issue_date < from) opening += d.total * (d.exchange_rate || 1);
  }
  for (const p of payments) {
    if (p.payment_date < from) opening -= p.amount * (p.exchange_rate || 1);
  }

  // Period transactions, merged and date-sorted (documents before payments on
  // the same day for a stable, readable order).
  type Txn = {
    raw_date: string;
    sort: number;
    reference: string;
    description: string;
    delta: number;
    isCharge: boolean;
    isPayment: boolean;
  };
  const txns: Txn[] = [];
  for (const d of docs) {
    if (d.issue_date < from || d.issue_date > to) continue;
    const base = d.total * (d.exchange_rate || 1);
    const isCredit = d.type === "credit_note";
    txns.push({
      raw_date: d.issue_date,
      sort: 0,
      reference: d.invoice_number,
      description: isCredit ? labels.credit_note : labels.invoice,
      delta: base,
      isCharge: !isCredit,
      isPayment: false,
    });
  }
  for (const p of payments) {
    if (p.payment_date < from || p.payment_date > to) continue;
    const base = p.amount * (p.exchange_rate || 1);
    txns.push({
      raw_date: p.payment_date,
      sort: 1,
      reference: p.invoice_number,
      description: labels.payment,
      delta: -base,
      isCharge: false,
      isPayment: true,
    });
  }
  txns.sort((a, b) =>
    a.raw_date < b.raw_date ? -1 : a.raw_date > b.raw_date ? 1 : a.sort - b.sort,
  );

  let running = opening;
  const lines: StatementLine[] = txns.map((tx) => {
    running += tx.delta;
    // Charge column shows positive debits; the credit column shows the absolute
    // value of payments and credit notes (both reduce the balance).
    const charge = tx.isCharge ? fmt(tx.delta) : "";
    const credit = !tx.isCharge ? fmt(Math.abs(tx.delta)) : "";
    return {
      raw_date: tx.raw_date,
      date: fdate(tx.raw_date),
      reference: tx.reference,
      description: tx.description,
      charge,
      credit,
      balance: fmt(running),
    };
  });

  // Aging snapshot of currently-outstanding invoices, as of `to`.
  const agingRows = db
    .query(
      `SELECT due_date, total, amount_paid, exchange_rate
       FROM invoices
       WHERE customer_id = ? AND deleted_at IS NULL
         AND status IN ('sent', 'partially_paid', 'overdue')
         AND (type = 'invoice' OR type IS NULL)`,
    )
    .all(customerId) as AgingRow[];
  const buckets = agingBuckets(agingRows, to, labels);
  const agingTotalRaw = buckets.reduce((s, b) => s + b.raw, 0);

  const addr = [
    customer.address_line1,
    customer.address_line2,
    [customer.postal_code, customer.city].filter(Boolean).join(" "),
    customer.state,
    customer.country,
  ]
    .filter(Boolean)
    .join("<br>");

  return {
    customer: {
      name: customer.name,
      email: customer.email,
      address: addr,
      tax_id: customer.tax_id,
    },
    company: {
      name: settings.company_name || "",
      email: settings.company_email || "",
      phone: settings.company_phone || "",
      address: (settings.company_address || "").replace(/\n/g, "<br>"),
      tax_id: settings.company_tax_id || "",
      logo: settings.company_logo || "",
    },
    period: { from: fdate(from), to: fdate(to) },
    statement_date: fdate(todayIso()),
    currency,
    opening_balance: fmt(opening),
    opening_balance_raw: opening,
    closing_balance: fmt(running),
    closing_balance_raw: running,
    lines,
    has_lines: lines.length > 0,
    aging: buckets.map((b) => ({ label: b.label, amount: fmt(b.raw), raw: b.raw })),
    aging_total: fmt(agingTotalRaw),
    aging_total_raw: agingTotalRaw,
    i18n: labels,
  };
}

export function renderStatementHtml(customerId: string, from: string, to: string): string | null {
  const data = buildStatementData(customerId, from, to);
  if (!data) return null;
  return Mustache.render(STATEMENT_TEMPLATE, data);
}
