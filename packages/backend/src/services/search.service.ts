import { getDb } from "../database/connection";

export type SearchKind = "invoice" | "customer" | "product";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  /** A short snippet of the matching text, with `<mark>` around hits. */
  snippet: string;
  /** BM25 rank — lower is better in SQLite FTS5. */
  rank: number;
  /** Display title joined to the row from its source table. */
  title: string;
  /** Optional secondary text — customer name on invoices, etc. */
  subtitle?: string | null;
}

/**
 * Run a full-text search across customers / products / invoices.
 *
 * Supports the FTS5 query syntax — bare words are AND-ed, prefix is
 * `term*`, and quoted phrases work. Falls back to an empty result set if the
 * search_index table doesn't exist (older SQLite without FTS5).
 */
export function search(
  query: string,
  options: { kind?: SearchKind; limit?: number } = {},
): SearchHit[] {
  const db = getDb();
  const limit = Math.min(Math.max(1, options.limit ?? 20), 100);

  const ftsExists = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='search_index'")
    .get();
  if (!ftsExists) return [];

  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  // Sanitize: FTS5's MATCH chokes on bare special characters. Wrap each token
  // and append a prefix wildcard so partial matches work as users type.
  const ftsQuery = trimmed
    .split(/\s+/)
    .map((tok) => tok.replace(/["*]/g, ""))
    .filter(Boolean)
    .map((tok) => `"${tok}"*`)
    .join(" ");
  if (!ftsQuery) return [];

  const conditions = ["search_index MATCH ?"];
  const params: (string | number)[] = [ftsQuery];
  if (options.kind) {
    conditions.push("kind = ?");
    params.push(options.kind);
  }

  const rows = db
    .query(
      `SELECT kind, id, snippet(search_index, 2, '<mark>', '</mark>', '…', 16) AS snippet, bm25(search_index) AS rank
       FROM search_index
       WHERE ${conditions.join(" AND ")}
       ORDER BY rank
       LIMIT ?`,
    )
    .all(...params, limit) as { kind: SearchKind; id: string; snippet: string; rank: number }[];

  if (rows.length === 0) return [];

  // Resolve titles by joining each id back to its source table.
  const byKind: Record<SearchKind, string[]> = { invoice: [], customer: [], product: [] };
  for (const r of rows) byKind[r.kind].push(r.id);

  const titles = new Map<string, { title: string; subtitle?: string | null }>();

  if (byKind.customer.length) {
    const placeholders = byKind.customer.map(() => "?").join(",");
    const cs = db
      .query(`SELECT id, name, email FROM customers WHERE id IN (${placeholders})`)
      .all(...byKind.customer) as { id: string; name: string; email: string | null }[];
    for (const c of cs) titles.set(`customer:${c.id}`, { title: c.name, subtitle: c.email });
  }
  if (byKind.product.length) {
    const placeholders = byKind.product.map(() => "?").join(",");
    const ps = db
      .query(`SELECT id, name, sku FROM products WHERE id IN (${placeholders})`)
      .all(...byKind.product) as { id: string; name: string; sku: string | null }[];
    for (const p of ps) titles.set(`product:${p.id}`, { title: p.name, subtitle: p.sku });
  }
  if (byKind.invoice.length) {
    const placeholders = byKind.invoice.map(() => "?").join(",");
    const inv = db
      .query(
        `SELECT i.id, i.invoice_number, c.name as customer_name FROM invoices i
         LEFT JOIN customers c ON i.customer_id = c.id
         WHERE i.id IN (${placeholders}) AND i.deleted_at IS NULL`,
      )
      .all(...byKind.invoice) as {
      id: string;
      invoice_number: string;
      customer_name: string | null;
    }[];
    for (const i of inv)
      titles.set(`invoice:${i.id}`, { title: i.invoice_number, subtitle: i.customer_name });
  }

  const hits: SearchHit[] = [];
  for (const r of rows) {
    const meta = titles.get(`${r.kind}:${r.id}`);
    if (!meta) continue;
    hits.push({
      kind: r.kind,
      id: r.id,
      snippet: r.snippet,
      rank: r.rank,
      title: meta.title,
      subtitle: meta.subtitle ?? null,
    });
  }
  return hits;
}
