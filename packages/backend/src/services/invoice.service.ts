import crypto from "node:crypto";
import { getDb } from "../database/connection";
import type { PaginatedResponse } from "../types/common";
import type {
  Invoice,
  InvoiceConsolidation,
  InvoiceConsolidationSource,
  InvoiceItem,
  InvoiceWithItems,
} from "../types/invoice";
import { todayIso } from "../utils/date";
import { HttpError } from "../utils/http-error";
import {
  generateCreditNoteNumber,
  generateDraftNumber,
  generateInvoiceNumber,
  isDraftNumber,
} from "../utils/invoice-number";
import { calculateInvoiceTotals, calculateLineItem } from "../utils/tax-calculator";
import { maybeAutoTransmit } from "./einvoice-transport.service";
import { getBaseCurrency } from "./exchange-rate.service";
import { applyLateFees } from "./late-fee.service";
import { recordPayment as recordPaymentService } from "./payment.service";
import { getTagsForItem, getTagsForItems, removeItemTags, setItemTags } from "./tag.service";

/**
 * Rate to store on an invoice: forced to 1 when it's already in the base
 * currency (so single-currency installs are always exactly consolidated),
 * otherwise the caller-supplied rate (manual or fetched), defaulting to 1.
 */
function resolveExchangeRate(currency: string | undefined, provided: number | undefined): number {
  const cur = (currency || "USD").toUpperCase();
  if (cur === getBaseCurrency().toUpperCase()) return 1;
  return provided && provided > 0 ? provided : 1;
}

interface InvoiceFilterParams {
  status?: string;
  customer_id?: string;
  from?: string;
  to?: string;
  search?: string;
  type?: string;
  /** Comma-separated tag names; matches invoices carrying ANY of them. */
  tags?: string;
  /** ISO timestamp; returns only rows changed at/after it (integration polling). */
  updated_since?: string;
}

interface InvoiceListParams extends InvoiceFilterParams {
  page: number;
  limit: number;
}

interface CreateInvoiceData {
  customer_id: string;
  issue_date: string;
  due_date?: string | null;
  invoice_number?: string;
  type?: "invoice" | "credit_note";
  reference_invoice_id?: string | null;
  notes?: string | null;
  payment_terms?: string | null;
  currency?: string;
  exchange_rate?: number;
  discount_type?: string | null;
  discount_value?: number;
  cash_discount_type?: string | null;
  cash_discount_value?: number;
  cash_discount_days?: number;
  locale?: string | null;
  template_id?: string | null;
  tags?: string[];
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

function buildInvoiceFilters(params: InvoiceFilterParams): {
  where: string;
  queryParams: string[];
} {
  const conditions: string[] = ["i.deleted_at IS NULL"];
  const queryParams: string[] = [];

  // Default to invoices only, unless type=all or type=credit_note
  if (params.type && params.type !== "all") {
    conditions.push("i.type = ?");
    queryParams.push(params.type);
  } else if (!params.type) {
    conditions.push("i.type = 'invoice'");
  }
  if (params.status) {
    conditions.push("i.status = ?");
    queryParams.push(params.status);
  }
  if (params.customer_id) {
    conditions.push("i.customer_id = ?");
    queryParams.push(params.customer_id);
  }
  if (params.from) {
    conditions.push("i.issue_date >= ?");
    queryParams.push(params.from);
  }
  if (params.to) {
    conditions.push("i.issue_date <= ?");
    queryParams.push(params.to);
  }
  if (params.search) {
    // Match the customer name too, so searching "Acme" surfaces Acme's
    // invoices. Queries using this filter must LEFT JOIN customers c.
    conditions.push("(i.invoice_number LIKE ? OR c.name LIKE ?)");
    queryParams.push(`%${params.search}%`, `%${params.search}%`);
  }
  if (params.updated_since) {
    conditions.push("i.updated_at >= ?");
    queryParams.push(params.updated_since);
  }
  if (params.tags) {
    const names = params.tags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length > 0) {
      conditions.push(
        `EXISTS (
           SELECT 1 FROM item_tags it
           JOIN tags tg ON tg.id = it.tag_id
           WHERE it.item_type = 'invoice' AND it.item_id = i.id
             AND LOWER(tg.name) IN (${names.map(() => "?").join(",")})
         )`,
      );
      queryParams.push(...names.map((n) => n.toLowerCase()));
    }
  }

  return { where: `WHERE ${conditions.join(" AND ")}`, queryParams };
}

export function listInvoices(
  params: InvoiceListParams,
): PaginatedResponse<Invoice & { customer_name: string; tags: string[] }> {
  const db = getDb();

  // Auto-detect overdue invoices (sent and partially_paid can become overdue)
  const today = todayIso();
  db.run(
    "UPDATE invoices SET status = 'overdue', updated_at = datetime('now') WHERE status IN ('sent', 'partially_paid') AND due_date IS NOT NULL AND due_date < ? AND deleted_at IS NULL",
    [today],
  );

  // Build-apply configured late fees to overdue invoices (idempotent). Late-fee
  // failures must never break invoice listing.
  try {
    applyLateFees();
  } catch {
    // swallowed: fees retry on the next list
  }

  const { page, limit } = params;
  const offset = (page - 1) * limit;
  const { where, queryParams } = buildInvoiceFilters(params);

  const countRow = db
    .query(
      `SELECT COUNT(*) as count FROM invoices i
     LEFT JOIN customers c ON i.customer_id = c.id ${where}`,
    )
    .get(...queryParams) as { count: number };

  const items = db
    .query(
      `SELECT i.*, c.name as customer_name FROM invoices i
     LEFT JOIN customers c ON i.customer_id = c.id
     ${where} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...queryParams, limit, offset) as (Invoice & { customer_name: string })[];

  const tags = getTagsForItems(
    items.map((i) => i.id),
    "invoice",
  );
  const taggedItems: (Invoice & { customer_name: string; tags: string[] })[] = items.map(
    (item) => ({
      ...item,
      tags: tags.get(item.id) ?? [],
    }),
  );

  // Latest PEPPOL transmission state per invoice, for the list's network icon.
  if (items.length > 0) {
    const placeholders = items.map(() => "?").join(",");
    const txRows = db
      .query(
        `SELECT t.invoice_id, t.status FROM einvoice_transmissions t
         JOIN (
           SELECT invoice_id, MAX(created_at) as m
           FROM einvoice_transmissions GROUP BY invoice_id
         ) latest ON latest.invoice_id = t.invoice_id AND latest.m = t.created_at
         WHERE t.invoice_id IN (${placeholders})`,
      )
      .all(...items.map((i) => i.id)) as { invoice_id: string; status: string }[];
    const byInvoice = new Map(txRows.map((r) => [r.invoice_id, r.status]));
    for (const item of taggedItems) {
      (item as Invoice & { peppol_status?: string }).peppol_status = byInvoice.get(item.id);
    }
  }

  return {
    items: taggedItems,
    total: countRow.count,
    page,
    limit,
    totalPages: Math.ceil(countRow.count / limit),
  };
}

/**
 * If `invoiceId` is the product of a consolidation, returns the group metadata
 * (the source invoices and their line items, in merge order) so downstream
 * consumers — PDF rendering, the detail view — can group line items per source.
 */
function getConsolidation(invoiceId: string): InvoiceConsolidation | null {
  const db = getDb();
  const group = db
    .query("SELECT g.id, g.name FROM invoice_groups g WHERE g.consolidated_invoice_id = ?")
    .get(invoiceId) as { id: string; name: string } | null;
  if (!group) return null;

  const members = db
    .query(
      `SELECT m.invoice_id, i.invoice_number, i.issue_date, i.subtotal, i.total
       FROM invoice_group_members m
       JOIN invoices i ON i.id = m.invoice_id
       WHERE m.group_id = ?
       ORDER BY m.rowid`,
    )
    .all(group.id) as {
    invoice_id: string;
    invoice_number: string;
    issue_date: string;
    subtotal: number;
    total: number;
  }[];

  const sources: InvoiceConsolidationSource[] = members.map((m) => ({
    id: m.invoice_id,
    invoice_number: m.invoice_number,
    issue_date: m.issue_date,
    subtotal: m.subtotal,
    total: m.total,
    items: db
      .query("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, created_at")
      .all(m.invoice_id) as InvoiceItem[],
  }));

  return { group_id: group.id, name: group.name, sources };
}

export function getInvoice(id: string): InvoiceWithItems | null {
  const db = getDb();
  const invoice = db
    .query(
      `SELECT i.*, c.name as customer_name, c.email as customer_email, c.id as cust_id
     FROM invoices i LEFT JOIN customers c ON i.customer_id = c.id WHERE i.id = ?`,
    )
    .get(id) as
    | (Invoice & { customer_name: string; customer_email: string | null; cust_id: string })
    | null;

  if (!invoice) return null;

  const items = db
    .query("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, created_at")
    .all(id) as InvoiceItem[];

  const consolidation = getConsolidation(id) ?? undefined;

  return {
    ...invoice,
    items,
    consolidation,
    tags: getTagsForItem(id, "invoice"),
    customer: {
      id: invoice.cust_id,
      name: invoice.customer_name,
      email: invoice.customer_email,
    },
  };
}

export function createInvoice(data: CreateInvoiceData): InvoiceWithItems {
  const db = getDb();

  // Wrap in transaction for atomicity (prevents invoice number race condition)
  const id = db.transaction(() => {
    const invoiceId = crypto.randomBytes(16).toString("hex");
    // Use provided number, or generate a draft placeholder for new drafts
    const invoiceNumber = data.invoice_number || generateDraftNumber();

    // Calculate totals
    const itemInputs = data.items.map((item) => ({
      quantity: item.quantity,
      unit_price: item.unit_price,
      tax_rate: item.tax_rate ?? 0,
    }));
    const totals = calculateInvoiceTotals(itemInputs, data.discount_type, data.discount_value);

    db.run(
      `INSERT INTO invoices (id, invoice_number, customer_id, status, type, reference_invoice_id,
       issue_date, due_date, subtotal, tax_total, discount_type, discount_value, discount_amount,
       cash_discount_type, cash_discount_value, cash_discount_days,
       total, notes, payment_terms, currency, exchange_rate, locale, template_id)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceId,
        invoiceNumber,
        data.customer_id,
        data.type || "invoice",
        data.reference_invoice_id || null,
        data.issue_date,
        data.due_date || null,
        totals.subtotal,
        totals.tax_total,
        data.discount_type || null,
        data.discount_value ?? 0,
        totals.discount_amount,
        data.cash_discount_type || null,
        data.cash_discount_value ?? 0,
        data.cash_discount_days ?? 0,
        totals.total,
        data.notes || null,
        data.payment_terms || null,
        data.currency || "USD",
        resolveExchangeRate(data.currency, data.exchange_rate),
        data.locale || null,
        data.template_id || null,
      ],
    );

    // Insert items
    const itemStmt = db.prepare(
      `INSERT INTO invoice_items (id, invoice_id, product_id, description, quantity, unit_price,
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
        invoiceId,
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

    return invoiceId;
  })();

  if (data.tags) setItemTags(id, "invoice", data.tags);

  return getInvoice(id)!;
}

export function updateInvoice(id: string, data: CreateInvoiceData): InvoiceWithItems | null {
  const db = getDb();
  const existing = db.query("SELECT id, status FROM invoices WHERE id = ?").get(id) as {
    id: string;
    status: string;
  } | null;
  if (!existing || existing.status !== "draft") return null;

  // Wrap in transaction for atomicity
  db.transaction(() => {
    const itemInputs = data.items.map((item) => ({
      quantity: item.quantity,
      unit_price: item.unit_price,
      tax_rate: item.tax_rate ?? 0,
    }));
    const totals = calculateInvoiceTotals(itemInputs, data.discount_type, data.discount_value);

    db.run(
      `UPDATE invoices SET customer_id = ?, issue_date = ?, due_date = ?,
       subtotal = ?, tax_total = ?, discount_type = ?, discount_value = ?,
       discount_amount = ?, cash_discount_type = ?, cash_discount_value = ?,
       cash_discount_days = ?, total = ?, notes = ?, payment_terms = ?,
       currency = ?, exchange_rate = ?, locale = ?, template_id = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        data.customer_id,
        data.issue_date,
        data.due_date || null,
        totals.subtotal,
        totals.tax_total,
        data.discount_type || null,
        data.discount_value ?? 0,
        totals.discount_amount,
        data.cash_discount_type || null,
        data.cash_discount_value ?? 0,
        data.cash_discount_days ?? 0,
        totals.total,
        data.notes || null,
        data.payment_terms || null,
        data.currency || "USD",
        resolveExchangeRate(data.currency, data.exchange_rate),
        data.locale || null,
        data.template_id || null,
        id,
      ],
    );

    // Replace items
    db.run("DELETE FROM invoice_items WHERE invoice_id = ?", [id]);
    const itemStmt = db.prepare(
      `INSERT INTO invoice_items (id, invoice_id, product_id, description, quantity, unit_price,
       unit, tax_id, tax_rate, tax_amount, line_total, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const item of data.items) {
      const itemId = crypto.randomBytes(16).toString("hex");
      const calc = calculateLineItem({
        quantity: item.quantity,
        unit_price: item.unit_price,
        tax_rate: item.tax_rate ?? 0,
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
        item.tax_rate ?? 0,
        calc.tax_amount,
        calc.line_total,
        item.sort_order ?? 0,
      );
    }
  })();

  if (data.tags) setItemTags(id, "invoice", data.tags);

  return getInvoice(id)!;
}

export function deleteInvoice(id: string): { success: boolean; error?: string } {
  const db = getDb();
  const existing = db
    .query("SELECT id FROM invoices WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { id: string } | null;
  if (!existing) return { success: false, error: "Invoice not found" };

  db.run(
    "UPDATE invoices SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    [id],
  );
  return { success: true };
}

export function restoreInvoice(id: string): { success: boolean; error?: string } {
  const db = getDb();
  const existing = db
    .query("SELECT id FROM invoices WHERE id = ? AND deleted_at IS NOT NULL")
    .get(id) as { id: string } | null;
  if (!existing) return { success: false, error: "Invoice not found in trash" };

  db.run("UPDATE invoices SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?", [id]);
  return { success: true };
}

export function permanentlyDeleteInvoice(id: string): { success: boolean; error?: string } {
  const db = getDb();
  const existing = db
    .query("SELECT id FROM invoices WHERE id = ? AND deleted_at IS NOT NULL")
    .get(id) as { id: string } | null;
  if (!existing) return { success: false, error: "Invoice not found in trash" };

  db.run("DELETE FROM invoices WHERE id = ?", [id]);
  removeItemTags(id, "invoice");
  return { success: true };
}

export function listTrashedInvoices(params: {
  page: number;
  limit: number;
}): PaginatedResponse<Invoice & { customer_name: string }> {
  const db = getDb();
  const { page, limit } = params;
  const offset = (page - 1) * limit;

  const countRow = db
    .query("SELECT COUNT(*) as count FROM invoices WHERE deleted_at IS NOT NULL")
    .get() as { count: number };

  const items = db
    .query(
      `SELECT i.*, c.name as customer_name FROM invoices i
     LEFT JOIN customers c ON i.customer_id = c.id
     WHERE i.deleted_at IS NOT NULL ORDER BY i.deleted_at DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as (Invoice & { customer_name: string })[];

  return {
    items,
    total: countRow.count,
    page,
    limit,
    totalPages: Math.ceil(countRow.count / limit),
  };
}

export function publishInvoice(id: string): InvoiceWithItems | null {
  const db = getDb();
  const existing = db
    .query("SELECT status, share_token FROM invoices WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { status: string; share_token: string | null } | null;
  if (!existing || !["sent", "paid", "overdue", "complete"].includes(existing.status)) return null;

  const shareToken = existing.share_token || crypto.randomBytes(16).toString("hex");
  db.run(
    "UPDATE invoices SET is_published = 1, share_token = ?, updated_at = datetime('now') WHERE id = ?",
    [shareToken, id],
  );
  return getInvoice(id);
}

export function unpublishInvoice(id: string): InvoiceWithItems | null {
  const db = getDb();
  const existing = db
    .query("SELECT status, is_published FROM invoices WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { status: string; is_published: number } | null;
  if (!existing?.is_published) return null;

  db.run("UPDATE invoices SET is_published = 0, updated_at = datetime('now') WHERE id = ?", [id]);
  return getInvoice(id);
}

export function voidInvoice(id: string): InvoiceWithItems | null {
  const db = getDb();
  const existing = db
    .query("SELECT status FROM invoices WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { status: string } | null;
  if (!existing || !["sent", "paid", "partially_paid", "overdue"].includes(existing.status))
    return null;

  db.run(
    "UPDATE invoices SET status = 'voided', is_published = 0, updated_at = datetime('now') WHERE id = ?",
    [id],
  );
  return getInvoice(id);
}

export function markPaid(id: string): InvoiceWithItems | null {
  const db = getDb();
  const existing = db
    .query(
      "SELECT id, status, total, amount_paid FROM invoices WHERE id = ? AND deleted_at IS NULL",
    )
    .get(id) as { id: string; status: string; total: number; amount_paid: number } | null;
  if (!existing || !["sent", "partially_paid", "overdue"].includes(existing.status)) return null;

  // Record a payment for the remaining balance
  const balance = existing.total - (existing.amount_paid || 0);
  if (balance > 0) {
    recordPaymentService(id, {
      amount: balance,
      payment_date: todayIso(),
      method: "other",
      notes: "Marked as fully paid",
    });
  } else {
    db.run("UPDATE invoices SET status = 'paid', updated_at = datetime('now') WHERE id = ?", [id]);
  }

  return getInvoice(id);
}

export function markComplete(id: string): InvoiceWithItems | null {
  const db = getDb();
  const existing = db
    .query("SELECT status FROM invoices WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { status: string } | null;
  if (!existing || existing.status !== "paid") return null;

  db.run("UPDATE invoices SET status = 'complete', updated_at = datetime('now') WHERE id = ?", [
    id,
  ]);
  return getInvoice(id);
}

/**
 * Put an invoice into the state a delivery email needs: numbered, sent, and
 * publicly reachable.
 *
 * Order matters and is the whole point of this function. `publishInvoice`
 * refuses anything still in `draft`, so the status has to leave draft first,
 * and publishing is what mints the `share_token` the email links to. Calling
 * them the other way round (as the send route did) leaves a draft `sent` but
 * unpublished with no token, and the customer gets an email with no way to
 * view or pay the invoice.
 *
 * For a draft, or an invoice already in a status `publishInvoice` accepts
 * (`sent`, `paid`, `overdue`, `complete`), the invoice ends up `sent` (or
 * unchanged, if it already left draft), `is_published = 1`, and holding a
 * non-null `share_token`. For any other status, such as `voided`,
 * `publishInvoice` silently no-ops and the invoice is left as it was.
 *
 * Idempotent: an already-sent, already-published invoice is returned unchanged.
 * Returns the re-read row, because both writes happen after the caller's copy
 * was loaded.
 */
export function finaliseForSending(id: string): InvoiceWithItems | null {
  const existing = getInvoice(id);
  if (!existing) return null;

  if (existing.status === "draft") markSent(id);
  if (!existing.is_published) publishInvoice(id);

  return getInvoice(id);
}

export function markSent(id: string): InvoiceWithItems | null {
  const db = getDb();
  const existing = db
    .query("SELECT status, invoice_number FROM invoices WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { status: string; invoice_number: string } | null;
  if (!existing || existing.status !== "draft") return null;

  // Assign a real sequential number if currently using a draft placeholder
  let assignedNumber: string | null = null;
  db.transaction(() => {
    if (isDraftNumber(existing.invoice_number)) {
      const MAX_RETRIES = 5;
      let assigned = false;
      for (let i = 0; i < MAX_RETRIES; i++) {
        const realNumber = generateInvoiceNumber();
        try {
          db.run(
            "UPDATE invoices SET invoice_number = ?, status = 'sent', updated_at = datetime('now') WHERE id = ?",
            [realNumber, id],
          );
          assigned = true;
          assignedNumber = realNumber;
          break;
        } catch (err) {
          // Uniqueness conflict — retry with next number
          if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) continue;
          throw err;
        }
      }
      if (!assigned) {
        throw new HttpError(
          503,
          "Could not assign a unique invoice number. Check for numbering conflicts or try again shortly.",
        );
      }
    } else {
      db.run("UPDATE invoices SET status = 'sent', updated_at = datetime('now') WHERE id = ?", [
        id,
      ]);
    }
  })();

  // Earlier activity entries (e.g. "created") captured the draft placeholder
  // number — rewrite their metadata so the log shows the final number.
  if (assignedNumber) {
    try {
      db.run(
        "UPDATE activity_log SET metadata = json_set(COALESCE(metadata, '{}'), '$.invoice_number', ?) WHERE resource_type = 'invoice' AND resource_id = ?",
        [assignedNumber, id],
      );
    } catch {
      // Backfilling the log is best-effort; never block the send.
    }
  }

  // Automatic PEPPOL transmit when enabled and the customer is reachable.
  // Fire-and-forget: a transport failure must never fail the invoice send.
  maybeAutoTransmit(id);

  return getInvoice(id);
}

export function duplicateInvoice(id: string): InvoiceWithItems | null {
  const existing = getInvoice(id);
  if (!existing) return null;

  return createInvoice({
    customer_id: existing.customer_id,
    type: "invoice",
    issue_date: todayIso(),
    due_date: existing.due_date,
    notes: existing.notes,
    payment_terms: existing.payment_terms,
    currency: existing.currency,
    locale: existing.locale,
    discount_type: existing.discount_type,
    discount_value: existing.discount_value,
    template_id: existing.template_id,
    tags: existing.tags,
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

export interface CreateConsolidatedData {
  customer_id: string;
  invoice_ids: string[];
  discount_type?: string | null;
  discount_value?: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Merge several draft invoices for one customer into a new consolidated draft.
 * The source line items are copied verbatim (reusing their stored line totals
 * guarantees the merged totals are the exact sum of the sources), a single
 * optional discount is applied to the merged subtotal, and the consolidation is
 * recorded in `invoice_groups` so the PDF can group items per source invoice.
 */
export function createConsolidated(data: CreateConsolidatedData): InvoiceWithItems {
  const db = getDb();
  const order = [...new Set(data.invoice_ids)];

  if (order.length < 2) {
    throw new HttpError(
      400,
      "Select at least two draft invoices to consolidate",
      undefined,
      "VALIDATION_FAILED",
    );
  }

  const customer = db.query("SELECT id FROM customers WHERE id = ?").get(data.customer_id);
  if (!customer) {
    throw new HttpError(404, "Customer not found", undefined, "NOT_FOUND");
  }

  const sources = order.map((id, idx) => {
    const source = getInvoice(id);
    if (!source) {
      throw new HttpError(404, `Invoice ${idx + 1} was not found`, undefined, "NOT_FOUND");
    }
    if (source.type !== "invoice") {
      throw new HttpError(
        400,
        `Invoice ${source.invoice_number} is not an invoice`,
        undefined,
        "VALIDATION_FAILED",
      );
    }
    if (source.status !== "draft") {
      throw new HttpError(
        400,
        `Invoice ${source.invoice_number} must be a draft to be consolidated`,
        undefined,
        "VALIDATION_FAILED",
      );
    }
    if (source.customer_id !== data.customer_id) {
      throw new HttpError(
        400,
        `Invoice ${source.invoice_number} belongs to a different customer`,
        undefined,
        "VALIDATION_FAILED",
      );
    }
    return source;
  });

  const currency = sources[0].currency;
  for (const source of sources) {
    if (source.currency !== currency) {
      throw new HttpError(
        400,
        "Cannot consolidate invoices with different currencies",
        undefined,
        "VALIDATION_FAILED",
      );
    }
  }

  const invoiceId = db.transaction(() => {
    const id = crypto.randomBytes(16).toString("hex");
    const number = generateDraftNumber();

    // Flatten items in source order, re-numbering sort_order across the merge.
    const itemRows: InvoiceItem[] = [];
    let sortOrder = 0;
    for (const source of sources) {
      for (const item of source.items) {
        itemRows.push({ ...item, sort_order: sortOrder++ });
      }
    }

    // Exact sum of the stored line/tax values so the merged totals match the
    // sources regardless of tax-inclusive pricing or rounding mode.
    let subtotal = 0;
    let taxTotal = 0;
    for (const item of itemRows) {
      subtotal += item.line_total;
      taxTotal += item.tax_amount;
    }
    subtotal = round2(subtotal);
    taxTotal = round2(taxTotal);

    let discountAmount = 0;
    if (data.discount_type === "percentage" && data.discount_value) {
      discountAmount = round2(subtotal * (Math.min(data.discount_value, 100) / 100));
    } else if (data.discount_type === "amount" && data.discount_value) {
      discountAmount = round2(Math.min(data.discount_value, subtotal));
    }
    const total = round2(subtotal - discountAmount + taxTotal);

    const notes = `Consolidated from ${sources.map((s) => s.invoice_number).join(", ")}`;

    db.run(
      `INSERT INTO invoices (id, invoice_number, customer_id, status, type, issue_date,
       subtotal, tax_total, discount_type, discount_value, discount_amount, total,
       notes, currency, exchange_rate)
       VALUES (?, ?, ?, 'draft', 'invoice', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        number,
        data.customer_id,
        todayIso(),
        subtotal,
        taxTotal,
        data.discount_type || null,
        data.discount_value ?? 0,
        discountAmount,
        total,
        notes,
        currency,
        resolveExchangeRate(currency, sources[0].exchange_rate),
      ],
    );

    const itemStmt = db.prepare(
      `INSERT INTO invoice_items (id, invoice_id, product_id, description, quantity, unit_price,
       unit, tax_id, tax_rate, tax_amount, line_total, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of itemRows) {
      itemStmt.run(
        crypto.randomBytes(16).toString("hex"),
        id,
        item.product_id,
        item.description,
        item.quantity,
        item.unit_price,
        item.unit,
        item.tax_id,
        item.tax_rate,
        item.tax_amount,
        item.line_total,
        item.sort_order,
      );
    }

    const groupId = crypto.randomBytes(16).toString("hex");
    db.run("INSERT INTO invoice_groups (id, name, consolidated_invoice_id) VALUES (?, ?, ?)", [
      groupId,
      sources.map((s) => s.invoice_number).join(", "),
      id,
    ]);
    const memberStmt = db.prepare(
      "INSERT INTO invoice_group_members (group_id, invoice_id) VALUES (?, ?)",
    );
    for (const source of sources) memberStmt.run(groupId, source.id);

    return id;
  })();

  return getInvoice(invoiceId)!;
}

export function getNextNumber(): string {
  return generateInvoiceNumber();
}

export function listInvoicesForExport(
  params: InvoiceFilterParams,
): (Invoice & { customer_name: string })[] {
  const db = getDb();
  const { where, queryParams } = buildInvoiceFilters(params);

  return db
    .query(
      `SELECT i.*, c.name as customer_name FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       ${where} ORDER BY i.created_at DESC`,
    )
    .all(...queryParams) as (Invoice & { customer_name: string })[];
}

export function createCreditNote(
  invoiceId: string,
): { success: true; data: InvoiceWithItems } | { success: false; error: string } {
  const source = getInvoice(invoiceId);
  if (!source) return { success: false, error: "Invoice not found" };
  if (!["sent", "paid", "overdue", "complete"].includes(source.status)) {
    return {
      success: false,
      error: "Credit notes can only be created from sent, paid, overdue, or complete invoices",
    };
  }

  const creditNote = createInvoice({
    customer_id: source.customer_id,
    type: "credit_note",
    reference_invoice_id: source.id,
    invoice_number: generateCreditNoteNumber(),
    issue_date: todayIso(),
    due_date: null,
    notes: `Credit note for invoice ${source.invoice_number}`,
    currency: source.currency,
    locale: source.locale,
    template_id: source.template_id,
    items: source.items.map((item) => ({
      product_id: item.product_id,
      description: item.description,
      quantity: item.quantity,
      unit_price: -Math.abs(item.unit_price),
      unit: item.unit,
      tax_id: item.tax_id,
      tax_rate: item.tax_rate,
      sort_order: item.sort_order,
    })),
  });

  return { success: true, data: creditNote };
}

export function listCreditNotes(invoiceId: string): (Invoice & { customer_name: string })[] {
  const db = getDb();
  return db
    .query(
      `SELECT i.*, c.name as customer_name FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       WHERE i.reference_invoice_id = ? AND i.type = 'credit_note' AND i.deleted_at IS NULL
       ORDER BY i.created_at DESC`,
    )
    .all(invoiceId) as (Invoice & { customer_name: string })[];
}

export function getNextCreditNoteNumber(): string {
  return generateCreditNoteNumber();
}

/**
 * Stamp a public-link view: set last_viewed_at always, first_viewed_at once.
 * Deliberately does NOT touch updated_at — a view isn't an edit. Returns whether
 * this was the first time the invoice was viewed (for one-shot notifications).
 */
export function recordInvoiceView(invoiceId: string): { isFirstView: boolean } {
  const db = getDb();
  const row = db.query("SELECT first_viewed_at FROM invoices WHERE id = ?").get(invoiceId) as {
    first_viewed_at: string | null;
  } | null;
  const isFirstView = !row?.first_viewed_at;
  if (isFirstView) {
    db.run(
      "UPDATE invoices SET first_viewed_at = datetime('now'), last_viewed_at = datetime('now') WHERE id = ?",
      [invoiceId],
    );
  } else {
    db.run("UPDATE invoices SET last_viewed_at = datetime('now') WHERE id = ?", [invoiceId]);
  }
  return { isFirstView };
}

export function getInvoiceByShareToken(shareToken: string): InvoiceWithItems | null {
  const db = getDb();
  const invoice = db
    .query("SELECT id, status, is_published FROM invoices WHERE share_token = ?")
    .get(shareToken) as { id: string; status: string; is_published: number } | null;

  if (!invoice) return null;
  if (!invoice.is_published) return null;
  if (!["sent", "paid", "overdue", "complete"].includes(invoice.status)) return null;

  return getInvoice(invoice.id);
}
