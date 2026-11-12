import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import {
  AFRelationship,
  type Color,
  PDFDocument,
  type PDFFont,
  PDFHexString,
  PDFName,
  type PDFPage,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineWidth,
  setStrokingColor,
  setTextRenderingMode,
  TextRenderingMode,
} from "pdf-lib";
import { formatCurrency } from "../utils/currency";
import { formatDateStr } from "../utils/date";
import type { XmlInvoiceData } from "../xml/types";

// Lightweight A4 renderer for the ZUGFeRD hybrid PDF. It embeds the Factur-X
// CII XML as an associated file (PDF/A-3 "Alternative" relationship) while the
// visible page stays simple (pdf-lib, no headless Chrome). The app's printable
// HTML templates are deliberately untouched: this PDF is only produced per
// customer when e-invoice emission is enabled.
// The file is PDF/A-3b, which ZUGFeRD and Factur-X require: the font is
// embedded (a DejaVu Sans subset), an sRGB output intent is set, and the XMP
// metadata carries the PDF/A identification plus the Factur-X extension schema
// that tells readers where the XML is. Bold text is the same font drawn with a
// thin outline, so only one font file ships.

const ASSETS = join(import.meta.dir, "..", "assets", "einvoice");
let fontBytes: Uint8Array | null = null;
let iccBytes: Uint8Array | null = null;
function assets(): { font: Uint8Array; icc: Uint8Array } {
  fontBytes ??= new Uint8Array(readFileSync(join(ASSETS, "DejaVuSans.ttf")));
  iccBytes ??= new Uint8Array(readFileSync(join(ASSETS, "sRGB2014.icc")));
  return { font: fontBytes, icc: iccBytes };
}

/** File name and conformance level of the embedded XML (Factur-X 1.0 / ZUGFeRD 2.x). */
export const FACTURX_FILE_NAME = "factur-x.xml";
const FACTURX_LEVEL = "EN 16931";

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 50;
const WIDTH = PAGE_W - MARGIN * 2; // 495
const TABLE_X = MARGIN;
const TABLE_W = WIDTH;
const RIGHT = PAGE_W - MARGIN; // right margin, 545
const META_LABEL_X = RIGHT - 170;

const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.45, 0.45, 0.45);
const FAINT = rgb(0.6, 0.6, 0.6);

// Column x-offsets (from TABLE_X): pos, description, quantity, unit price, total
// (quantity, unit price and total are right edges)
const COL_POS = 0;
const COL_DESC = 30;
const COL_QTY = 315;
const COL_PRICE = 405;
const COL_TOTAL = TABLE_W;
const TOTALS_LABEL = 285;

interface EinvoicePdfInput {
  data: XmlInvoiceData;
  /** Factur-X XML (CII) to embed as an associated file. */
  facturXml: string;
  /** Name used for the embedded file stream (default: factur-x.xml). */
  xmlFileName?: string;
  /** Name of the generated PDF (default: <invoice_number>.pdf). */
  pdfName?: string;
}

interface EinvoicePdfResult {
  pdfBytes: Uint8Array;
  pdfName: string;
}

export async function buildEinvoicePdf(input: EinvoicePdfInput): Promise<EinvoicePdfResult> {
  const { data, facturXml } = input;
  const isCredit = data.type === "credit_note";
  const currency = data.currency || "EUR";
  const localeOverride = normalizeEinvoiceLocale(data.locale);
  const numberFormat = data.number_format || undefined;
  const dateFormat = data.date_format || "DD.MM.YYYY";
  const money = (n: number) => formatCurrency(n, currency, numberFormat, localeOverride);
  const fdate = (iso: string) => formatDateStr(iso, dateFormat, localeOverride);

  // PDF/A compares the Info dictionary with the XMP metadata, so both get the
  // same values (dates to the second).
  const created = new Date(Math.floor(Date.now() / 1000) * 1000);
  const title = `${isCredit ? "Gutschrift" : "Rechnung"} ${data.invoice_number}`;
  const subject = `${isCredit ? "Credit note" : "Invoice"} ${data.invoice_number}`;
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle(title);
  pdf.setSubject(subject);
  pdf.setCreator("Inkvoice");
  pdf.setProducer("Inkvoice");
  pdf.setCreationDate(created);
  pdf.setModificationDate(created);

  pdf.registerFontkit(fontkit);
  const { font: ttf, icc } = assets();
  const font = await pdf.embedFont(ttf, { subset: true });
  const page = pdf.addPage([PAGE_W, PAGE_H]);

  let y = PAGE_H - MARGIN;

  // ---------- Seller block (left) ----------
  text(page, String(data.supplier.name || "").toUpperCase(), 13, MARGIN, y, font, INK, true);
  y -= 17;
  const sellerAddr = [
    data.supplier.address,
    data.supplier.street,
    [data.supplier.postal_code, data.supplier.city].filter(Boolean).join(" "),
    data.supplier.country,
  ].filter(Boolean);
  y = lines(page, sellerAddr.join("\n"), 10, MARGIN, y, font, INK, 13);
  const contact = [
    data.supplier.email && `E-Mail: ${data.supplier.email}`,
    data.supplier.phone && `Telefon: ${data.supplier.phone}`,
  ].filter(Boolean);
  if (contact.length) y = lines(page, contact.join("\n"), 9, MARGIN, y, font, MUTED, 12);
  const taxLines = [
    data.supplier.tax_id && `USt-IdNr.: ${data.supplier.tax_id}`,
    data.supplier.tax_number && `Steuernummer: ${data.supplier.tax_number}`,
  ].filter(Boolean);
  if (taxLines.length) y = lines(page, taxLines.join("\n"), 9, MARGIN, y, font, MUTED, 12);

  // ---------- Document meta (right) ----------
  right(page, isCredit ? "GUTSCHRIFT" : "RECHNUNG", 18, RIGHT, PAGE_H - MARGIN, font, INK, true);
  const meta: Array<[string, string]> = [
    [isCredit ? "Gutschrift-Nr." : "Rechnungs-Nr.", data.invoice_number],
    ["Datum", fdate(data.issue_date)],
    ...(data.due_date ? [["Fällig am", fdate(data.due_date)] as [string, string]] : []),
    ...(data.service_date
      ? [["Leistungsdatum", fdate(data.service_date)] as [string, string]]
      : []),
    // The period takes two rows: both dates on one row would run into the label.
    ...(data.service_period
      ? ([
          ["Leistungszeitraum", fdate(data.service_period.start)],
          ["", `bis ${fdate(data.service_period.end)}`],
        ] as Array<[string, string]>)
      : []),
    ["Währung", currency.toUpperCase()],
  ];
  let metaY = PAGE_H - MARGIN - 28;
  for (const [label, value] of meta) {
    if (label) text(page, label, 8, META_LABEL_X, metaY, font, MUTED);
    right(page, value, 9, RIGHT, metaY, font, INK);
    metaY -= 15;
  }

  // ---------- Buyer block ----------
  const buyerLines = [
    data.customer.name,
    data.customer.address_line1,
    data.customer.address_line2,
    [data.customer.postal_code, data.customer.city].filter(Boolean).join(" "),
    data.customer.country,
    data.customer.tax_id && `USt-IdNr.: ${data.customer.tax_id}`,
  ].filter(Boolean);

  const buyerTop = Math.min(y, metaY + 15) - 26;
  lines(page, "Rechnungsempfänger", 8, MARGIN, buyerTop, font, MUTED, 11);
  lines(page, buyerLines.join("\n"), 10, MARGIN, buyerTop - 12, font, INK, 13);
  const buyerHeight = buyerLines.length * 13 + 12;

  // ---------- Line items table ----------
  let tableY = buyerTop - buyerHeight - 6;
  tableY = hline(page, tableY, true);

  tableY -= 13;
  tableHeader(page, font, tableY);
  tableY -= 15;
  tableY = hline(page, tableY, false);

  tableY -= 20;

  const items = (data.items || []).map((it, i) => ({
    no: String(i + 1),
    desc: it.description,
    qty: fmtQty(it.quantity),
    price: money(it.unit_price),
    total: money(it.line_total),
  }));

  for (const it of items) {
    text(page, it.no, 9, MARGIN + COL_POS, tableY, font, INK);
    const descLines = wrapText(page, it.desc, font, 9, COL_QTY - COL_DESC - 45);
    const descCount = descLines.split("\n").length;
    lines(page, descLines, 9, MARGIN + COL_DESC, tableY, font, INK, 12);
    // Numbers sit on the first line of the description.
    right(page, it.qty, 9, MARGIN + COL_QTY, tableY, font, INK);
    right(page, it.price, 9, MARGIN + COL_PRICE, tableY, font, INK);
    right(page, it.total, 9, MARGIN + COL_TOTAL, tableY, font, INK);
    tableY -= descCount * 12 + 8;
  }

  // ---------- Totals ----------
  // A Kleinunternehmer charges no VAT; the § 19 note below says so instead.
  const taxRows: Array<[string, string]> = data.kleinunternehmer
    ? []
    : data.tax_breakdown.map((tax) => [taxLabel(tax), money(tax.tax_amount)]);

  tableY -= 8;
  tableY = drawTotals(page, font, tableY, [
    ["Zwischensumme", money(data.subtotal)],
    ...(data.discount_amount
      ? [["Rabatt", `- ${money(data.discount_amount)}`] as [string, string]]
      : []),
    ...taxRows,
  ]);
  tableY = drawTotal(
    page,
    font,
    tableY,
    isCredit ? "Gutschrift gesamt" : "Gesamtbetrag",
    money(data.total),
    10,
  );

  if (data.kleinunternehmer) {
    tableY -= 6;
    tableY = lines(
      page,
      "Kleinunternehmer gemäß §19 Abs.1 UStG: keine Umsatzsteuer ausgewiesen.",
      8,
      MARGIN,
      tableY,
      font,
      MUTED,
      11,
    );
  }

  // ---------- Notes / payment terms ----------
  const reverseCharge = data.tax_breakdown.some(
    (t) => (t.category_code || "").toUpperCase() === "AE",
  );
  const notes = [
    reverseCharge && "Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge).",
    data.payment_terms && `Zahlungsbedingungen: ${data.payment_terms}`,
    data.notes,
    data.supplier.bank_details,
  ].filter((v): v is string => !!v);
  if (notes.length) {
    tableY -= 10;
    tableY = lines(page, "Anmerkungen", 8, MARGIN, tableY, font, MUTED, 11);
    for (const n of notes) {
      tableY -= 2;
      tableY = lines(page, wrapText(page, n, font, 9, TABLE_W), 9, MARGIN, tableY, font, INK, 12);
    }
  }

  // ---------- Footer ----------
  page.drawLine({
    start: { x: MARGIN, y: 40 },
    end: { x: MARGIN + TABLE_W, y: 40 },
    thickness: 0.3,
    color: FAINT,
  });
  text(
    page,
    `E-Rechnung (${isCredit ? "Gutschrift" : "Rechnung"} · ZUGFeRD/Factur-X) mit eingebettetem XML. Gesamt ${money(data.total)}`,
    7,
    MARGIN,
    28,
    font,
    MUTED,
  );

  // ---------- Embed Factur-X XML (PDF/A-3 associated file) ----------
  const xmlFileName = input.xmlFileName || FACTURX_FILE_NAME;
  await pdf.attach(utf8Bytes(facturXml), xmlFileName, {
    mimeType: "application/xml",
    description: `Factur-X ${isCredit ? "Gutschrift" : "Rechnung"} ${data.invoice_number}`,
    creationDate: created,
    modificationDate: created,
    afRelationship: AFRelationship.Alternative,
  });

  makePdfA3(pdf, { title, subject, created, icc, xmlFileName, fingerprint: facturXml });

  return { pdfBytes: await pdf.save(), pdfName: input.pdfName || `${data.invoice_number}.pdf` };
}

// ---------- PDF/A-3b + Factur-X metadata ----------

function makePdfA3(
  pdf: PDFDocument,
  meta: {
    title: string;
    subject: string;
    created: Date;
    icc: Uint8Array;
    xmlFileName: string;
    fingerprint: string;
  },
): void {
  const ctx = pdf.context;

  // Output intent: device RGB colours are interpreted as sRGB.
  const iccRef = ctx.register(ctx.flateStream(meta.icc, { N: 3 }));
  const intent = ctx.obj({
    Type: "OutputIntent",
    S: "GTS_PDFA1",
    OutputConditionIdentifier: PDFString.of("sRGB IEC61966-2.1"),
    Info: PDFString.of("sRGB IEC61966-2.1"),
    DestOutputProfile: iccRef,
  });
  pdf.catalog.set(PDFName.of("OutputIntents"), ctx.obj([ctx.register(intent)]));

  // XMP metadata, uncompressed as PDF/A requires.
  const xmp = new TextEncoder().encode(buildXmp(meta));
  const metadata = ctx.stream(xmp, { Type: "Metadata", Subtype: "XML", Length: xmp.length });
  pdf.catalog.set(PDFName.of("Metadata"), ctx.register(metadata));

  // PDF/A needs a file identifier in the trailer.
  const id = createHash("sha256").update(meta.fingerprint).digest("hex").slice(0, 32);
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(id), PDFHexString.of(id)]);
}

function xmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildXmp(meta: {
  title: string;
  subject: string;
  created: Date;
  xmlFileName: string;
}): string {
  const date = meta.created.toISOString().replace(/\.\d{3}Z$/, "Z");
  const fxProperty = (name: string, description: string) => `
              <rdf:li rdf:parseType="Resource">
                <pdfaProperty:name>${name}</pdfaProperty:name>
                <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                <pdfaProperty:category>external</pdfaProperty:category>
                <pdfaProperty:description>${description}</pdfaProperty:description>
              </rdf:li>`;
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(meta.title)}</rdf:li></rdf:Alt></dc:title>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(meta.subject)}</rdf:li></rdf:Alt></dc:description>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>Inkvoice</xmp:CreatorTool>
      <xmp:CreateDate>${date}</xmp:CreateDate>
      <xmp:ModifyDate>${date}</xmp:ModifyDate>
      <xmp:MetadataDate>${date}</xmp:MetadataDate>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
      <pdf:Producer>Inkvoice</pdf:Producer>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>${xmlText(meta.xmlFileName)}</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>${FACTURX_LEVEL}</fx:ConformanceLevel>
    </rdf:Description>
    <rdf:Description rdf:about=""
        xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
        xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
        xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>${fxProperty("DocumentFileName", "The name of the embedded XML document")}${fxProperty("DocumentType", "The type of the hybrid document in capital letters, e.g. INVOICE or ORDER")}${fxProperty("Version", "The actual version of the standard applying to the embedded XML document")}${fxProperty("ConformanceLevel", "The conformance level of the embedded XML document")}
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

// ---------- drawing helpers ----------

function text(
  page: PDFPage,
  txt: string,
  size: number,
  x: number,
  y: number,
  font: PDFFont,
  color = INK,
  strong = false,
): void {
  if (!strong) {
    page.drawText(txt, { x, y, size, font, color });
    return;
  }
  // Bold: fill plus a thin outline in the text colour.
  page.pushOperators(
    pushGraphicsState(),
    setTextRenderingMode(TextRenderingMode.FillAndOutline),
    setLineWidth(size * 0.035),
    setStrokingColor(color as Color),
  );
  page.drawText(txt, { x, y, size, font, color });
  page.pushOperators(popGraphicsState());
}

function right(
  page: PDFPage,
  txt: string,
  size: number,
  rightX: number,
  y: number,
  font: PDFFont,
  color = INK,
  strong = false,
): void {
  text(page, txt, size, rightX - font.widthOfTextAtSize(txt, size), y, font, color, strong);
}

function lines(
  page: PDFPage,
  txt: string,
  size: number,
  x: number,
  y: number,
  font: PDFFont,
  color = INK,
  lineHeight: number,
): number {
  for (const line of txt.split("\n")) {
    page.drawText(line, { x, y, size, font, color });
    y -= lineHeight;
  }
  return y;
}

function wrapText(
  page: PDFPage,
  txt: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  const out: string[] = [];
  let line = "";
  for (const word of txt.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.join("\n");
}

function hline(page: PDFPage, y: number, strong: boolean): number {
  page.drawLine({
    start: { x: TABLE_X, y },
    end: { x: TABLE_X + TABLE_W, y },
    thickness: strong ? 0.8 : 0.3,
    color: strong ? INK : FAINT,
  });
  return y;
}

function tableHeader(page: PDFPage, font: PDFFont, y: number): void {
  const cols: Array<[string, number, boolean]> = [
    ["Pos.", COL_POS, false],
    ["Beschreibung", COL_DESC, false],
    ["Menge", COL_QTY, true],
    ["Einzelpreis", COL_PRICE, true],
    ["Gesamt", COL_TOTAL, true],
  ];
  for (const [label, x, alignRight] of cols) {
    if (alignRight) right(page, label, 8, MARGIN + x, y, font, MUTED);
    else text(page, label, 8, MARGIN + x, y, font, MUTED);
  }
}

function drawTotals(
  page: PDFPage,
  font: PDFFont,
  y: number,
  rows: Array<[string, string]>,
): number {
  for (const [label, value] of rows) {
    text(page, label, 9, MARGIN + TOTALS_LABEL, y, font, INK);
    right(page, value, 9, MARGIN + COL_TOTAL, y, font, INK);
    y -= 13;
  }
  return y;
}

function drawTotal(
  page: PDFPage,
  bold: PDFFont,
  y: number,
  label: string,
  value: string,
  size: number,
): number {
  text(page, label, size, MARGIN + TOTALS_LABEL, y, bold, INK, true);
  right(page, value, size, MARGIN + COL_TOTAL, y, bold, INK, true);
  return y - size - 4;
}

// ---------- formatting helpers ----------

function taxLabel(tax: XmlInvoiceData["tax_breakdown"][number]): string {
  if (tax.tax_rate === 0) {
    const zero: Record<string, string> = {
      E: "Steuerbefreit",
      AE: "Reverse Charge",
      K: "Steuerfreie innergem. Lieferung",
      G: "Steuerfreie Ausfuhr",
      O: "Nicht steuerbar",
    };
    return zero[(tax.category_code || "").toUpperCase()] || "Umsatzsteuer 0 %";
  }
  const rate = tax.tax_rate % 1 === 0 ? tax.tax_rate.toFixed(0) : tax.tax_rate.toFixed(2);
  return `Umsatzsteuer ${rate} %`;
}

function normalizeEinvoiceLocale(locale: string | null | undefined): string | undefined {
  const tag = (locale || "").trim();
  if (!tag) return undefined;
  // Bare language tags like "de" have no region, so Intl keeps prefix € ("€ 1.234,56")
  // instead of Germany's suffix ("1.234,56 €").
  if (tag.toLowerCase() === "de") return "de-DE";
  return tag;
}

function fmtQty(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3).replace(/\.?0+$/, "");
}

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
