import crypto from "node:crypto";
import { getDb } from "../database/connection";
import type { PaginatedResponse } from "../types/common";
import type { Quote, QuoteItem, QuoteWithItems } from "../types/quote";
import { todayIso } from "../utils/date";
import { generateQuoteNumber } from "../utils/invoice-number";
import { calculateInvoiceTotals, calculateLineItem } from "../utils/tax-calculator";
import { createInvoice, getInvoice } from "./invoice.service";

interface QuoteFilterParams {
  status?: string;
  customer_id?: string;
  from?: string;
  to?: string;
  search?: string;
  /** ISO timestamp; returns only rows changed at/after it (integration polling). */
  updated_since?: string;
}

interface QuoteListParams extends QuoteFilterParams {
  page: number;
  limit: number;
}

interface CreateQuoteData {
  customer_id: string;
  issue_date: string;
  valid_until?: string | null;
  quote_number?: string;
  notes?: string | null;
  currency?: string;
  discount_type?: string | null;
  discount_value?: number;
  locale?: string | null;
  template_id?: string | null;
  items: {
    product_id?: string | null;
    description: string;
    quantity: number;
    unit_price: number;
    unit?: string;
    tax_id?: string | null;
    tax_rate?: number;
    sort_order?: number;
  }[];
}

function autoExpireQuotes(): void {
  const db = getDb();
  const today = todayIso();
  db.run(
    "UPDATE quotes SET status = 'expired', updated_at = datetime('now') WHERE status IN ('draft', 'sent') AND valid_until IS NOT NULL AND valid_until < ? AND deleted_at IS NULL",
    [today],
  );
}

function buildQuoteFilters(params: QuoteFilterParams): {
  where: string;
  queryParams: string[];
} {
  const conditions: string[] = ["q.deleted_at IS NULL"];
  const queryParams: string[] = [];

  if (params.status) {
    conditions.push("q.status = ?");
    queryParams.push(params.status);
  }
  if (params.customer_id) {
    conditions.push("q.customer_id = ?");
    queryParams.push(params.customer_id);
  }
  if (params.from) {
    conditions.push("q.issue_date >= ?");
    queryParams.push(params.from);
  }
  if (params.to) {
    conditions.push("q.issue_date <= ?");
    queryParams.push(params.to);
  }
  if (params.search) {
    // Match the customer name too, so searching "Acme" surfaces Acme's
    // quotes. Queries using this filter must LEFT JOIN customers c.
    conditions.push("(q.quote_number LIKE ? OR c.name LIKE ?)");
    queryParams.push(`%${params.search}%`, `%${params.search}%`);
  }
  if (params.updated_since) {
    conditions.push("q.updated_at >= ?");
    queryParams.push(params.updated_since);
  }

  return { where: `WHERE ${conditions.join(" AND ")}`, queryParams };
}

export function listQuotes(
  params: QuoteListParams,
): PaginatedResponse<Quote & { customer_name: string }> {
  const db = getDb();

  // Auto-expire quotes past their valid_until date
  autoExpireQuotes();

  const { page, limit } = params;
  const offset = (page - 1) * limit;
  const { where, queryParams } = buildQuoteFilters(params);

  const countRow = db
    .query(
      `SELECT COUNT(*) as count FROM quotes q
     LEFT JOIN customers c ON q.customer_id = c.id ${where}`,
    )
    .get(...queryParams) as { count: number };

  const items = db
    .query(
      `SELECT q.*, c.name as customer_name FROM quotes q
     LEFT JOIN customers c ON q.customer_id = c.id
     ${where} ORDER BY q.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...queryParams, limit, offset) as (Quote & { customer_name: string })[];

  return {
    items,
    total: countRow.count,
    page,
    limit,
    totalPages: Math.ceil(countRow.count / limit),
  };
}

export function getQuote(id: string): QuoteWithItems | null {
  const db = getDb();
  const quote = db
    .query(
      `SELECT q.*, c.name as customer_name, c.email as customer_email, c.id as cust_id
     FROM quotes q LEFT JOIN customers c ON q.customer_id = c.id WHERE q.id = ?`,
    )
    .get(id) as
    | (Quote & { customer_name: string; customer_email: string | null; cust_id: string })
    | null;

  if (!quote) return null;

  const items = db
    .query("SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order, created_at")
    .all(id) as QuoteItem[];

  return {
    ...quote,
    items,
    customer: {
      id: quote.cust_id,
      name: quote.customer_name,
      email: quote.customer_email,
    },
  };
}

export function createQuote(data: CreateQuoteData): QuoteWithItems {
  const db = getDb();

  const id = db.transaction(() => {
    const quoteId = crypto.randomBytes(16).toString("hex");
    const quoteNumber = data.quote_number || generateQuoteNumber();

    // Calculate totals
    const itemInputs = data.items.map((item) => ({
      quantity: item.quantity,
      unit_price: item.unit_price,
      tax_rate: item.tax_rate ?? 0,
    }));
    const totals = calculateInvoiceTotals(itemInputs, data.discount_type, data.discount_value);

    db.run(
      `INSERT INTO quotes (id, quote_number, customer_id, status,
       issue_date, valid_until, subtotal, tax_total, discount_type, discount_value, discount_amount,
       total, notes, currency, locale, template_id)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quoteId,
        quoteNumber,
        data.customer_id,
        data.issue_date,
        data.valid_until || null,
        totals.subtotal,
        totals.tax_total,
        data.discount_type || null,
        data.discount_value ?? 0,
        totals.discount_amount,
        totals.total,
        data.notes || null,
        data.currency || "USD",
        data.locale || null,
        data.template_id || null,
      ],
    );

    // Insert items
    const itemStmt = db.prepare(
      `INSERT INTO quote_items (id, quote_id, product_id, description, quantity, unit_price,
       unit, tax_id, tax_rate, tax_amount, line_total, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const item of data.items) {
      const itemId = crypto.randomBytes(16).toString("hex");
      // Resolve tax rate from definition if tax_id is provided
      let taxRate = item.tax_rate ?? 0;
      if (item.tax_id) {
        const taxDef = db
          .query("SELECT rate FROM tax_definitions WHERE id = ?")
          .get(item.tax_id) as { rate: number } | null;
        if (taxDef) taxRate = taxDef.rate;
      }
      const calc = calculateLineItem({
        quantity: item.quantity,
        unit_price: item.unit_price,
        tax_rate: taxRate,
      });
      itemStmt.run(
        itemId,
        quoteId,
        item.product_id || null,
        item.description,
        item.quantity,
        item.unit_price,
        item.unit || "piece",
        item.tax_id || null,
        taxRate,
        calc.tax_amount,
        calc.line_total,
        item.sort_order ?? 0,
      );
    }

    return quoteId;
  })();

  return getQuote(id)!;
}

export function updateQuote(id: string, data: CreateQuoteData): QuoteWithItems | null {
  const db = getDb();
  const existing = db
    .query("SELECT id, status FROM quotes WHERE id = ? AND deleted_at IS NULL")
    .get(id) as {
    id: string;
    status: string;
  } | null;
  if (!existing || existing.status !== "draft") return null;

  db.transaction(() => {
    const itemInputs = data.items.map((item) => ({
      quantity: item.quantity,
      unit_price: item.unit_price,
      tax_rate: item.tax_rate ?? 0,
    }));
    const totals = calculateInvoiceTotals(itemInputs, data.discount_type, data.discount_value);

    db.run(
      `UPDATE quotes SET customer_id = ?, issue_date = ?, valid_until = ?,
       subtotal = ?, tax_total = ?, discount_type = ?, discount_value = ?,
       discount_amount = ?, total = ?, notes = ?,
       currency = ?, locale = ?, template_id = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        data.customer_id,
        data.issue_date,
        data.valid_until || null,
        totals.subtotal,
        totals.tax_total,
        data.discount_type || null,
        data.discount_value ?? 0,
        totals.discount_amount,
        totals.total,
        data.notes || null,
        data.currency || "USD",
        data.locale || null,
        data.template_id || null,
        id,
      ],
    );

    // Replace items
    db.run("DELETE FROM quote_items WHERE quote_id = ?", [id]);
    const itemStmt = db.prepare(
      `INSERT INTO quote_items (id, quote_id, product_id, description, quantity, unit_price,
       unit, tax_id, tax_rate, tax_amount, line_total, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const item of data.items) {
      const itemId = crypto.randomBytes(16).toString("hex");
      let taxRate = item.tax_rate ?? 0;
      if (item.tax_id) {
        const taxDef = db
          .query("SELECT rate FROM tax_definitions WHERE id = ?")
          .get(item.tax_id) as { rate: number } | null;
        if (taxDef) taxRate = taxDef.rate;
      }
      const calc = calculateLineItem({
        quantity: item.quantity,
        unit_price: item.unit_price,
        tax_rate: taxRate,
      });
      itemStmt.run(
        itemId,
        id,
        item.product_id || null,
        item.description,
        item.quantity,
        item.unit_price,
        item.unit || "piece",
        item.tax_id || null,
        taxRate,
        calc.tax_amount,
        calc.line_total,
        item.sort_order ?? 0,
      );
    }
  })();

  return getQuote(id)!;
}

export function deleteQuote(id: string): { success: boolean; error?: string } {
  const db = getDb();
  const existing = db
    .query("SELECT id FROM quotes WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { id: string } | null;
  if (!existing) return { success: false, error: "Quote not found" };

  db.run(
    "UPDATE quotes SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    [id],
  );
  return { success: true };
}

export function publishQuote(id: string): QuoteWithItems | null {
  const db = getDb();
  const existing = db
    .query("SELECT status, share_token FROM quotes WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { status: string; share_token: string | null } | null;
  if (!existing || !["draft", "sent"].includes(existing.status)) return null;

  const shareToken = existing.share_token || crypto.randomBytes(16).toString("hex");
  db.run(
    "UPDATE quotes SET is_published = 1, share_token = ?, updated_at = datetime('now') WHERE id = ?",
    [shareToken, id],
  );
  return getQuote(id);
}

export function sendQuote(id: string): QuoteWithItems | null {
  const db = getDb();
  const existing = db
    .query("SELECT status FROM quotes WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { status: string } | null;
  if (!existing || existing.status !== "draft") return null;

  db.run("UPDATE quotes SET status = 'sent', updated_at = datetime('now') WHERE id = ?", [id]);
  return getQuote(id);
}

export function acceptQuote(id: string): QuoteWithItems | null {
  const db = getDb();
  const existing = db
    .query("SELECT status FROM quotes WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { status: string } | null;
  if (!existing || !["sent", "draft"].includes(existing.status)) return null;

  db.run("UPDATE quotes SET status = 'accepted', updated_at = datetime('now') WHERE id = ?", [id]);
  return getQuote(id);
}

export function rejectQuote(id: string): QuoteWithItems | null {
  const db = getDb();
  const existing = db
    .query("SELECT status FROM quotes WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { status: string } | null;
  if (!existing || !["sent", "draft"].includes(existing.status)) return null;

  db.run("UPDATE quotes SET status = 'rejected', updated_at = datetime('now') WHERE id = ?", [id]);
  return getQuote(id);
}

export function duplicateQuote(id: string): QuoteWithItems | null {
  const existing = getQuote(id);
  if (!existing) return null;

  return createQuote({
    customer_id: existing.customer_id,
    issue_date: todayIso(),
    valid_until: existing.valid_until,
    notes: existing.notes,
    currency: existing.currency,
    locale: existing.locale,
    discount_type: existing.discount_type,
    discount_value: existing.discount_value,
    template_id: existing.template_id,
    items: existing.items.map((item) => ({
      product_id: item.product_id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      unit: item.unit,
      tax_id: item.tax_id,
      tax_rate: item.tax_rate,
      sort_order: item.sort_order,
    })),
  });
}

export function convertToInvoice(
  quoteId: string,
):
  | { success: true; data: { quote: QuoteWithItems; invoice_id: string } }
  | { success: false; error: string } {
  const db = getDb();
  const existing = getQuote(quoteId);
  if (!existing) return { success: false, error: "Quote not found" };
  if (existing.status === "converted") {
    return { success: false, error: "Quote has already been converted" };
  }
  if (existing.status === "rejected" || existing.status === "expired") {
    return { success: false, error: `Cannot convert a ${existing.status} quote` };
  }

  // Create invoice from quote data
  const invoice = createInvoice({
    customer_id: existing.customer_id,
    issue_date: todayIso(),
    notes: existing.notes,
    currency: existing.currency,
    locale: existing.locale,
    discount_type: existing.discount_type,
    discount_value: existing.discount_value,
    template_id: existing.template_id,
    items: existing.items.map((item) => ({
      product_id: item.product_id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      unit: item.unit,
      tax_id: item.tax_id,
      tax_rate: item.tax_rate,
      sort_order: item.sort_order,
    })),
  });

  // Mark quote as converted
  db.run(
    "UPDATE quotes SET status = 'converted', converted_invoice_id = ?, updated_at = datetime('now') WHERE id = ?",
    [invoice.id, quoteId],
  );

  const updatedQuote = getQuote(quoteId)!;
  return { success: true, data: { quote: updatedQuote, invoice_id: invoice.id } };
}

export function createQuoteFromInvoice(
  invoiceId: string,
): { success: true; data: QuoteWithItems } | { success: false; error: string } {
  const source = getInvoice(invoiceId);
  if (!source) return { success: false, error: "Invoice not found" };
  if (source.type === "credit_note") {
    return { success: false, error: "Credit notes cannot be duplicated as quotes" };
  }
  const quote = createQuote({
    customer_id: source.customer_id,
    issue_date: todayIso(),
    valid_until: null,
    notes: source.notes,
    currency: source.currency,
    locale: source.locale,
    discount_type: source.discount_type,
    discount_value: source.discount_value,
    template_id: source.template_id,
    items: source.items.map((item) => ({
      product_id: item.product_id,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      unit: item.unit,
      tax_id: item.tax_id,
      tax_rate: item.tax_rate,
      sort_order: item.sort_order,
    })),
  });
  return { success: true, data: quote };
}

export function getNextNumber(): string {
  return generateQuoteNumber();
}

export function getQuoteByShareToken(shareToken: string): QuoteWithItems | null {
  const db = getDb();
  const quote = db
    .query("SELECT id, status, is_published FROM quotes WHERE share_token = ?")
    .get(shareToken) as { id: string; status: string; is_published: number } | null;

  if (!quote) return null;
  if (!quote.is_published) return null;

  return getQuote(quote.id);
}
