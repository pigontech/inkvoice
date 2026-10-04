import { createHash, randomBytes } from "node:crypto";
import { getDb } from "../database/connection";
import { buildXmlInvoiceData } from "../xml/build-data";
import { getProfile } from "../xml/profile-registry";
import { buildEinvoicePdf } from "./einvoice-pdf.service";
import { type EinvoiceIssue, validateEinvoice } from "./einvoice-validator.service";
import { getAllSettings } from "./settings.service";

// E-invoice emission (Germany). Decides the target format per invoice
// (customer override -> setting -> default ZUGFeRD; B2G customers with a
// Leitweg-ID are emitted as XRechnung), builds the XML, wraps it into a
// ZUGFeRD hybrid PDF when applicable, stores the revision in
// einvoice_documents and returns it for download/delivery.

export type EinvoiceFormat = "zugferd" | "xrechnung-ubl" | "xrechnung-cii" | "peppol";

/** Maps the UI/storage format name to the registered XML profile id. */
function formatToProfileId(format: EinvoiceFormat): string {
  if (format === "zugferd") return "facturx-zugferd";
  if (format === "peppol") return "ubl-peppol";
  return format; // xrechnung-ubl (and xrechnung-cii if a profile exists later)
}

export interface EinvoiceEmitResult {
  id: string;
  invoice_id: string;
  format: string;
  hash: string;
  xml: string;
  /** PDF/A-3 hybrid bytes (ZUGFeRD only, null otherwise). */
  pdf: Uint8Array | null;
  issues: EinvoiceIssue[];
  created_at: string;
}

export function resolveEinvoiceFormat(opts: {
  customerFormat?: string | null;
  settingFormat?: string | null;
  leitwegId?: string | null;
}): EinvoiceFormat {
  const requested = normalizeFormat(opts.customerFormat || opts.settingFormat || null);
  if (opts.leitwegId && requested === "zugferd") return "xrechnung-ubl";
  return requested;
}

function normalizeFormat(fmt: string | null | undefined): EinvoiceFormat {
  const f = (fmt || "").trim().toLowerCase();
  if (f === "xrechnung" || f === "xrechnung-ubl") return "xrechnung-ubl";
  if (f === "xrechnung-cii") return "xrechnung-cii";
  if (f === "peppol") return "peppol";
  return "zugferd";
}

export async function emitEinvoice(
  invoiceId: string,
  opts: { forceFormat?: EinvoiceFormat } = {},
): Promise<EinvoiceEmitResult> {
  const data = buildXmlInvoiceData(invoiceId);
  const settings = getAllSettings();

  const format =
    opts.forceFormat ??
    resolveEinvoiceFormat({
      customerFormat: data.customer.einvoice_format,
      settingFormat: settings.einvoice_format,
      leitwegId: data.customer.leitweg_id,
    });

  const issues = validateEinvoice(data, format);
  const profile = getProfile(formatToProfileId(format));
  if (!profile) {
    throw new Error(
      `E-invoice format "${format}" is not supported (available: zugferd, xrechnung-ubl).`,
    );
  }

  const xml = profile.generateXml(data);

  // ZUGFeRD is always delivered as a hybrid PDF (XML embedded, PDF/A-3).
  // Standalone XRechnung stays an XML document; the UI offers both.
  let pdf: Uint8Array | null = null;
  if (format === "zugferd" && settings.einvoice_attach_pdf !== "false") {
    const { pdfBytes } = await buildEinvoicePdf({ data, facturXml: xml });
    pdf = pdfBytes;
  }

  const hash = createHash("sha256").update(xml).digest("hex");
  const id = randomBytes(16).toString("hex");

  getDb()
    .query(
      `INSERT INTO einvoice_documents (id, invoice_id, format, xml_content, pdf_content, hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, invoiceId, format, xml, pdf ? Buffer.from(pdf) : null, hash);

  return {
    id,
    invoice_id: invoiceId,
    format,
    hash,
    xml,
    pdf,
    issues,
    created_at: new Date().toISOString(),
  };
}

export interface EinvoiceRecord {
  id: string;
  invoice_id: string;
  format: string;
  hash: string;
  created_at: string;
  has_xml: number;
  has_pdf: number;
}

export function listEinvoiceRecords(invoiceId: string): EinvoiceRecord[] {
  const rows = getDb()
    .query(
      `SELECT id, invoice_id, format, hash, created_at,
              (xml_content IS NOT NULL AND xml_content != '') AS has_xml,
              (pdf_content IS NOT NULL) AS has_pdf
       FROM einvoice_documents
       WHERE invoice_id = ?
       ORDER BY created_at DESC`,
    )
    .all(invoiceId) as unknown as EinvoiceRecord[];
  return rows;
}

export function getEinvoiceXml(recordId: string): string | null {
  const row = getDb()
    .query("SELECT xml_content FROM einvoice_documents WHERE id = ?")
    .get(recordId) as { xml_content: string | null } | undefined;
  return row?.xml_content || null;
}

export function getEinvoicePdf(recordId: string): Buffer | null {
  const row = getDb()
    .query("SELECT pdf_content FROM einvoice_documents WHERE id = ?")
    .get(recordId) as { pdf_content: Uint8Array | null } | undefined;
  return row?.pdf_content ? Buffer.from(row.pdf_content) : null;
}

export function deleteEinvoiceRecord(recordId: string): boolean {
  const res = getDb().query("DELETE FROM einvoice_documents WHERE id = ?").run(recordId);
  return Number(res.changes) > 0;
}
