import { createHash } from "node:crypto";
import { getDb } from "../database/connection";

// E-invoice inbox (receiving side, Germany). Incoming XRechnung/ZUGFeRD XML
// documents are stored as-is (hash for dedupe) and parsed with a targeted,
// dependency-free extractor for the CII (Factur-X) and UBL (XRechnung) shapes
// this app emits and that are common in the German market. Full EN 16931
// validation of received documents is out of scope for now; parse errors are
// surfaced per document so the user can still archive the raw file.

export type InboxStatus = "inbox" | "processed" | "archived";
export type ParseStatus = "pending" | "ok" | "error";

export interface InboxItem {
  id: string;
  document_number: string | null;
  issue_date: string | null;
  supplier_name: string | null;
  supplier_vat_id: string | null;
  total: number | null;
  currency: string | null;
  file_name: string;
  content_type: string | null;
  status: InboxStatus;
  customer_id: string | null;
  parse_status: ParseStatus;
  parse_error: string | null;
  /** "upload" (manual) or "peppol" (network arrival). */
  source: string;
  transport_id: string | null;
  provider_message_id: string | null;
  sender_scheme: string | null;
  sender_id: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface ParsedEinvoice {
  document_number: string | null;
  issue_date: string | null;
  supplier_name: string | null;
  supplier_vat_id: string | null;
  total: number | null;
  currency: string | null;
}

export function importEinvoiceFile(opts: {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  /** "upload" (default) or "peppol". */
  source?: string;
  transportId?: string;
  providerMessageId?: string;
  senderScheme?: string;
  senderId?: string;
}): { id: string; duplicate: boolean } {
  const db = getDb();
  const raw = Buffer.from(opts.bytes);
  const hash = createHash("sha256").update(raw).digest("hex");

  const existing = getDb().query("SELECT id FROM einvoice_inbox WHERE raw_hash = ?").get(hash) as {
    id: string;
  } | null;
  if (existing) return { id: existing.id, duplicate: true };

  const text =
    opts.contentType.includes("xml") || /\.xml$/i.test(opts.fileName)
      ? raw.toString("utf-8")
      : null;
  const parsed = text ? parseEinvoiceXml(text) : null;

  const id = createHash("sha1").update(`${hash}${Date.now()}`).digest("hex").slice(0, 32);
  db.query(
    `INSERT INTO einvoice_inbox
       (id, document_number, issue_date, supplier_name, supplier_vat_id, total, currency,
        file_name, content_type, raw_content, raw_hash, status, parse_status, parse_error,
        source, transport_id, provider_message_id, sender_scheme, sender_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inbox', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    parsed?.document_number ?? null,
    parsed?.issue_date ?? null,
    parsed?.supplier_name ?? null,
    parsed?.supplier_vat_id ?? null,
    parsed?.total ?? null,
    parsed?.currency ?? null,
    opts.fileName,
    opts.contentType,
    raw,
    hash,
    parsed ? "ok" : "error",
    parsed
      ? null
      : text
        ? "Could not extract invoice data from XML (unsupported structure)."
        : "Only XML e-invoices can be parsed; the raw file was stored for archiving.",
    opts.source ?? "upload",
    opts.transportId ?? null,
    opts.providerMessageId ?? null,
    opts.senderScheme ?? null,
    opts.senderId ?? null,
  );
  return { id, duplicate: false };
}

export function listInboxItems(status?: InboxStatus): InboxItem[] {
  const db = getDb();
  const rows = status
    ? db.query("SELECT * FROM einvoice_inbox WHERE status = ? ORDER BY created_at DESC").all(status)
    : db.query("SELECT * FROM einvoice_inbox ORDER BY created_at DESC").all();
  return (rows as Record<string, unknown>[]).map(toItem);
}

export function getInboxItem(id: string): InboxItem | null {
  const row = getDb().query("SELECT * FROM einvoice_inbox WHERE id = ?").get(id) as Record<
    string,
    unknown
  > | null;
  return row ? toItem(row) : null;
}

export function getInboxRaw(id: string): { bytes: Uint8Array; fileName: string } | null {
  const row = getDb()
    .query("SELECT raw_content, file_name FROM einvoice_inbox WHERE id = ?")
    .get(id) as { raw_content: Uint8Array; file_name: string } | undefined;
  if (!row) return null;
  return { bytes: new Uint8Array(row.raw_content), fileName: row.file_name };
}

export function updateInboxStatus(id: string, status: InboxStatus): boolean {
  const res = getDb()
    .query(
      `UPDATE einvoice_inbox SET status = ?, processed_at = CASE WHEN ? = 'processed' THEN datetime('now') ELSE processed_at END WHERE id = ?`,
    )
    .run(status, status, id);
  return Number(res.changes) > 0;
}

export function linkInboxToCustomer(id: string, customerId: string | null): boolean {
  const res = getDb()
    .query("UPDATE einvoice_inbox SET customer_id = ? WHERE id = ?")
    .run(customerId, id);
  return Number(res.changes) > 0;
}

export function deleteInboxItem(id: string): boolean {
  const res = getDb().query("DELETE FROM einvoice_inbox WHERE id = ?").run(id);
  return Number(res.changes) > 0;
}

function toItem(row: Record<string, unknown>): InboxItem {
  return {
    id: String(row.id),
    document_number: row.document_number != null ? String(row.document_number) : null,
    issue_date: row.issue_date != null ? isoDate(String(row.issue_date)) : null,
    supplier_name: row.supplier_name != null ? String(row.supplier_name) : null,
    supplier_vat_id: row.supplier_vat_id != null ? String(row.supplier_vat_id) : null,
    total: row.total != null ? Number(row.total) : null,
    currency: row.currency != null ? String(row.currency) : null,
    file_name: String(row.file_name),
    content_type: row.content_type != null ? String(row.content_type) : null,
    status: row.status as InboxStatus,
    customer_id: row.customer_id != null ? String(row.customer_id) : null,
    parse_status: row.parse_status as ParseStatus,
    parse_error: row.parse_error != null ? String(row.parse_error) : null,
    source: row.source != null ? String(row.source) : "upload",
    transport_id: row.transport_id != null ? String(row.transport_id) : null,
    provider_message_id: row.provider_message_id != null ? String(row.provider_message_id) : null,
    sender_scheme: row.sender_scheme != null ? String(row.sender_scheme) : null,
    sender_id: row.sender_id != null ? String(row.sender_id) : null,
    created_at: String(row.created_at),
    processed_at: row.processed_at != null ? String(row.processed_at) : null,
  };
}

// ---------- targeted XML extraction (CII Factur-X + UBL XRechnung) ----------

export function parseEinvoiceXml(xml: string): ParsedEinvoice {
  if (xml.includes("CrossIndustryInvoice")) {
    return parseCii(xml);
  }
  if (xml.includes("Invoice") && xml.includes("urn:oasis:names:specification:ubl")) {
    return parseUbl(xml);
  }
  return {
    document_number: null,
    issue_date: null,
    supplier_name: null,
    supplier_vat_id: null,
    total: null,
    currency: null,
  };
}

function firstMatch(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? decodeXml(m[1].trim()) : null;
}

function parseCii(xml: string): ParsedEinvoice {
  const seller = xml.includes("<ram:SellerTradeParty>")
    ? xml.slice(xml.indexOf("<ram:SellerTradeParty>"), xml.indexOf("</ram:SellerTradeParty>"))
    : xml;
  const document_number = firstMatch(
    xml,
    /<(?:rsm|ram|\w+):ExchangedDocument[^>]*>\s*<(?:ram|\w+):ID>([^<]+)<\//,
  );
  const issue_date = isoDate(
    firstMatch(xml, /<ram:IssueDateTime>\s*<udt:DateTimeString[^>]*>([^<]+)<\/udt:DateTimeString>/),
  );
  const supplier_name = firstMatch(seller, /<ram:Name>([^<]+)<\/ram:Name>/);
  const supplier_vat_id = firstMatch(seller, /<ram:ID schemeID="VA">([^<]+)<\/ram:ID>/);
  const currency = firstMatch(
    xml,
    /<ram:InvoiceCurrencyCode>([A-Z]{3})<\/ram:InvoiceCurrencyCode>/,
  );
  const total = firstMatch(xml, /<ram:GrandTotalAmount>([0-9.]+)<\/ram:GrandTotalAmount>/);
  return {
    document_number,
    issue_date,
    supplier_name,
    supplier_vat_id,
    total: total != null ? Number(total) : null,
    currency,
  };
}

function parseUbl(xml: string): ParsedEinvoice {
  const supplier = xml.includes("<cac:AccountingSupplierParty>")
    ? xml.slice(
        xml.indexOf("<cac:AccountingSupplierParty>"),
        xml.indexOf("</cac:AccountingSupplierParty>"),
      )
    : xml;
  const document_number = firstMatch(xml, /<cbc:ID[^>]*>([^<]+)<\/cbc:ID>/);
  const issue_date = firstMatch(xml, /<cbc:IssueDate[^>]*>([^<]+)<\/cbc:IssueDate>/);
  const supplier_name =
    firstMatch(supplier, /<cbc:RegistrationName[^>]*>([^<]+)<\/cbc:RegistrationName>/) ||
    firstMatch(supplier, /<cbc:Name[^>]*>([^<]+)<\/cbc:Name>/);
  const supplier_vat_id = firstMatch(supplier, /<cbc:CompanyID[^>]*>([^<]+)<\/cbc:CompanyID>/);
  const currency = firstMatch(
    xml,
    /<cbc:DocumentCurrencyCode[^>]*>([A-Z]{3})<\/cbc:DocumentCurrencyCode>/,
  );
  const total = firstMatch(
    xml,
    /<cbc:TaxInclusiveAmount[^>]*>([0-9.-]+)<\/cbc:TaxInclusiveAmount>/,
  );
  return {
    document_number,
    issue_date,
    supplier_name,
    supplier_vat_id,
    total: total != null ? Number(total) : null,
    currency,
  };
}

/**
 * CII dates use format 102 (YYYYMMDD); the inbox keeps ISO dates like the UBL
 * IssueDate. Also applied when reading, for rows imported in the raw form.
 */
function isoDate(date: string | null): string | null {
  return date?.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3") ?? null;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
