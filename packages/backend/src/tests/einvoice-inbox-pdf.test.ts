import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import type { Hono } from "hono";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createApp } from "../app";
import { closeDatabase, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import type { InboxItem } from "../services/einvoice-inbox.service";
import { resetEnvCache } from "../utils/env";

// Received ZUGFeRD / Factur-X hybrid PDFs: the inbox reads the embedded XML
// like an XML upload, keeps the PDF as it is, and survives broken or hostile
// files. The hybrid PDFs come from scripts/einvoice-samples.ts (the ones CI
// checks with Mustang); the hostile ones are built by hand below.

const TEST_DB = "./data/test-einvoice-inbox-pdf.db";
const SAMPLES_SCRIPT = join(import.meta.dir, "../../../../scripts/einvoice-samples.ts");
let app: Hono;
let token: string;
let samplesDir: string;
let samplePdfs: string[];

const NO_XML = "No XRechnung or ZUGFeRD XML found in this PDF";
const TOO_LARGE = "too large to read";
const UNREADABLE = "The PDF could not be read";
const ENCRYPTED = "The PDF is encrypted";

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "testpass123456";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  process.env.RATE_LIMIT_ENABLED = "false";
  resetEnvCache();

  initDatabase();
  runMigrations();
  await seed();
  app = createApp();

  const res = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "testpass123456" }),
  });
  token = ((await res.json()) as { data: { token: string } }).data.token;

  samplesDir = mkdtempSync(join(tmpdir(), "inkvoice-einvoice-samples-"));
  const run = Bun.spawnSync([process.execPath, "run", SAMPLES_SCRIPT, samplesDir], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (run.exitCode !== 0) throw new Error(`einvoice-samples failed: ${run.stderr.toString()}`);
  samplePdfs = readdirSync(samplesDir)
    .filter((f) => f.endsWith(".pdf"))
    .sort();
});

afterAll(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
  rmSync(samplesDir, { recursive: true, force: true });
});

function authed(path: string, opts: RequestInit = {}) {
  return app.request(
    new Request(`http://localhost${path}`, {
      ...opts,
      headers: {
        ...((opts.headers as Record<string, string>) || {}),
        Authorization: `Bearer ${token}`,
      },
    }),
  );
}

async function upload(
  bytes: Uint8Array | string,
  name: string,
  type = "application/pdf",
): Promise<{ status: number; id: string; duplicate: boolean; item: InboxItem }> {
  const form = new FormData();
  form.append(
    "file",
    new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name, { type }),
  );
  const res = await authed("/api/v1/einvoices/inbox/import", { method: "POST", body: form });
  const { data } = (await res.json()) as { data: { id: string; duplicate: boolean } };
  const item = (
    (await (await authed(`/api/v1/einvoices/inbox/${data.id}`)).json()) as {
      data: InboxItem;
    }
  ).data;
  return { status: res.status, id: data.id, duplicate: data.duplicate, item };
}

const fields = (item: InboxItem) => ({
  document_number: item.document_number,
  issue_date: item.issue_date,
  supplier_name: item.supplier_name,
  supplier_vat_id: item.supplier_vat_id,
  total: item.total,
  currency: item.currency,
});

// ---------- hand-built PDFs (classic xref table, objects written as given) ----------

const enc = new TextEncoder();

function concat(parts: (string | Uint8Array)[]): Uint8Array {
  const bytes = parts.map((p) => (typeof p === "string" ? enc.encode(p) : p));
  const out = new Uint8Array(bytes.reduce((n, b) => n + b.length, 0));
  let pos = 0;
  for (const b of bytes) {
    out.set(b, pos);
    pos += b.length;
  }
  return out;
}

function stream(dict: string, data: Uint8Array | string): Uint8Array {
  const body = typeof data === "string" ? enc.encode(data) : data;
  return concat([`<< ${dict} /Length ${body.length} >>\nstream\n`, body, "\nendstream"]);
}

/** objects[i] is the body of object i + 1. */
function buildPdf(objects: (string | Uint8Array)[], trailer = "/Root 1 0 R"): Uint8Array {
  const parts: (string | Uint8Array)[] = ["%PDF-1.7\n"];
  const offsets: number[] = [];
  let pos = enc.encode(parts[0] as string).length;
  const push = (part: string | Uint8Array) => {
    parts.push(part);
    pos += typeof part === "string" ? enc.encode(part).length : part.length;
  };
  objects.forEach((body, i) => {
    offsets.push(pos);
    push(`${i + 1} 0 obj\n`);
    push(body);
    push("\nendobj\n");
  });
  const xref = pos;
  const rows = offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${rows}`);
  push(`trailer\n<< /Size ${objects.length + 1} ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`);
  return concat(parts);
}

/** UTF-16BE hex string with BOM, as PDF writers store non-ASCII file names. */
function utf16Hex(s: string): string {
  let hex = "FEFF";
  for (const ch of s) hex += ch.charCodeAt(0).toString(16).padStart(4, "0");
  return `<${hex}>`;
}

/** Catalog (1) -> AF -> file spec (2) -> embedded file (3). */
function pdfWithAttachment(name: string, file: Uint8Array, filter = "/Filter /FlateDecode") {
  return buildPdf([
    "<< /Type /Catalog /Pages 4 0 R /AF [2 0 R] >>",
    `<< /Type /Filespec /F (${name}) /UF (${name}) /EF << /F 3 0 R >> /AFRelationship /Alternative >>`,
    stream(`/Type /EmbeddedFile /Subtype /text#2Fxml ${filter}`, file),
    "<< /Type /Pages /Kids [] /Count 0 >>",
  ]);
}

describe("E-invoice inbox: hybrid PDFs", () => {
  test("the sample script produced hybrid PDFs", () => {
    expect(samplePdfs.length).toBeGreaterThanOrEqual(6);
  });

  test("a ZUGFeRD PDF fills the same fields as importing its XML", async () => {
    for (const pdfName of samplePdfs) {
      const pdf = new Uint8Array(readFileSync(join(samplesDir, pdfName)));
      const xml = readFileSync(join(samplesDir, pdfName.replace(/\.pdf$/, ".xml")), "utf-8");

      const fromPdf = await upload(pdf, pdfName);
      const fromXml = await upload(xml, pdfName.replace(/\.pdf$/, ".xml"), "application/xml");
      expect(fromPdf.status).toBe(201);
      expect(fromPdf.item.parse_status).toBe("ok");
      expect(fromPdf.item.parse_error).toBeNull();
      expect(fields(fromPdf.item)).toEqual(fields(fromXml.item));
      expect(fromPdf.item.document_number).toBeTruthy();
      expect(fromPdf.item.issue_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(fromPdf.item.supplier_name).toBe("Anna Beispiel Design");
      expect(typeof fromPdf.item.total).toBe("number");
      expect(fromPdf.item.file_name).toBe(pdfName);

      // The PDF itself is archived unchanged.
      const raw = await authed(`/api/v1/einvoices/inbox/${fromPdf.id}/raw`);
      expect(new Uint8Array(await raw.arrayBuffer())).toEqual(pdf);
    }
  });

  test("a PDF is recognised by its content, whatever its name and type", async () => {
    const pdf = new Uint8Array(readFileSync(join(samplesDir, samplePdfs[0])));
    const renamed = concat([pdf, "\n% sent as attachment.bin\n"]);
    const { item } = await upload(renamed, "attachment.bin", "application/octet-stream");
    expect(item.parse_status).toBe("ok");
    expect(item.document_number).toBeTruthy();
  });

  test("uploading the same PDF again is a duplicate", async () => {
    const pdf = new Uint8Array(readFileSync(join(samplesDir, samplePdfs[0])));
    const again = await upload(pdf, "again.pdf");
    expect(again.status).toBe(200);
    expect(again.duplicate).toBe(true);
  });

  test("several PDFs uploaded at once are all read", async () => {
    const pdf = new Uint8Array(readFileSync(join(samplesDir, samplePdfs[0])));
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => upload(concat([pdf, `\n% copy ${n}\n`]), `copy-${n}.pdf`)),
    );
    for (const { item } of results) expect(item.parse_status).toBe("ok");
  });

  test("XML found through a name tree with kids, stored without compression", async () => {
    const xml = readFileSync(join(samplesDir, samplePdfs[0].replace(/\.pdf$/, ".xml")));
    const pdf = buildPdf([
      "<< /Type /Catalog /Pages 8 0 R /Names << /EmbeddedFiles 2 0 R >> >>",
      "<< /Kids [3 0 R] >>",
      "<< /Limits [(notes.txt) (zugferd-invoice.xml)] /Names [(notes.txt) 4 0 R (zugferd-invoice.xml) 6 0 R] >>",
      "<< /Type /Filespec /F (notes.txt) /EF << /F 5 0 R >> >>",
      stream("/Type /EmbeddedFile", "not an invoice"),
      "<< /Type /Filespec /F (ZUGFeRD-invoice.xml) /EF << /F 7 0 R >> >>",
      stream("/Type /EmbeddedFile /Subtype /text#2Fxml", new Uint8Array(xml)),
      "<< /Type /Pages /Kids [] /Count 0 >>",
    ]);
    const { item } = await upload(pdf, "name-tree.pdf");
    expect(item.parse_status).toBe("ok");
    expect(item.supplier_name).toBe("Anna Beispiel Design");
  });

  test("XML found through the AF array with a UTF-16 file name", async () => {
    const xml = readFileSync(join(samplesDir, samplePdfs[0].replace(/\.pdf$/, ".xml")));
    const pdf = buildPdf([
      "<< /Type /Catalog /Pages 4 0 R /AF [2 0 R] >>",
      `<< /Type /Filespec /UF ${utf16Hex("factur-x.xml")} /EF << /UF 3 0 R >> >>`,
      stream("/Type /EmbeddedFile /Filter /FlateDecode", deflateSync(xml)),
      "<< /Type /Pages /Kids [] /Count 0 >>",
    ]);
    const { item } = await upload(pdf, "af-only.pdf");
    expect(item.parse_status).toBe("ok");
    expect(item.document_number).toBeTruthy();
  });
});

describe("E-invoice inbox: PDFs without readable XML", () => {
  test("a plain PDF is stored as it is", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    page.drawText("Rechnung 4711", { font: await doc.embedFont(StandardFonts.Helvetica) });
    const pdf = new Uint8Array(await doc.save());
    const { status, id, item } = await upload(pdf, "scan.pdf");
    expect(status).toBe(201);
    expect(item.parse_status).toBe("error");
    expect(item.parse_error).toContain(NO_XML);
    expect(item.document_number).toBeNull();
    const raw = await authed(`/api/v1/einvoices/inbox/${id}/raw`);
    expect(new Uint8Array(await raw.arrayBuffer())).toEqual(pdf);
  });

  test("a PDF attachment with another name is not taken for the invoice", async () => {
    const pdf = pdfWithAttachment("invoice-copy.xml", deflateSync("<rsm:CrossIndustryInvoice/>"));
    const { item } = await upload(pdf, "other-name.pdf");
    expect(item.parse_error).toContain(NO_XML);
  });

  test("broken files are stored with an error", async () => {
    const garbage = concat(["%PDF-1.7\n", crypto.getRandomValues(new Uint8Array(4096))]);
    const sample = readFileSync(join(samplesDir, samplePdfs[0]));
    const truncated = new Uint8Array(sample.subarray(0, Math.floor(sample.length / 2)));
    const cases: [Uint8Array | string, string][] = [
      [garbage, "garbage.pdf"],
      [truncated, "truncated.pdf"],
      ["this is not a pdf", "fake.pdf"],
    ];
    for (const [bytes, name] of cases) {
      const { status, item } = await upload(bytes, name);
      expect(status).toBe(201);
      expect(item.parse_status).toBe("error");
      expect([UNREADABLE, NO_XML].some((m) => item.parse_error?.includes(m))).toBe(true);
    }
  });

  test("an encrypted PDF is reported as such", async () => {
    const pdf = buildPdf(
      [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [] /Count 0 >>",
        "<< /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>",
      ],
      "/Root 1 0 R /Encrypt 3 0 R",
    );
    const { item } = await upload(pdf, "encrypted.pdf");
    expect(item.parse_error).toContain(ENCRYPTED);
  });
});

describe("E-invoice inbox: hostile PDFs", () => {
  test("an object stream that inflates past the limit is refused", async () => {
    const bomb = deflateSync(Buffer.alloc(16 * 1024 * 1024, 0x20));
    const pdf = buildPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [] /Count 0 >>",
      stream("/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode", bomb),
    ]);
    const { item } = await upload(pdf, "objstm-bomb.pdf");
    expect(item.parse_error).toContain(TOO_LARGE);
  });

  test("an embedded XML that inflates past the limit is refused", async () => {
    const bomb = deflateSync(Buffer.alloc(16 * 1024 * 1024, 0x3c));
    const { item } = await upload(pdfWithAttachment("factur-x.xml", bomb), "xml-bomb.pdf");
    expect(item.parse_error).toContain(TOO_LARGE);
  });

  test("filter chains count against the same limit", async () => {
    const twice = deflateSync(deflateSync(Buffer.alloc(16 * 1024 * 1024, 0x3c)));
    const pdf = pdfWithAttachment("factur-x.xml", twice, "/Filter [/FlateDecode /FlateDecode]");
    const { item } = await upload(pdf, "double-bomb.pdf");
    expect(item.parse_error).toContain(TOO_LARGE);
  });

  test("a PDF with too many objects is refused", async () => {
    const pdf = buildPdf([`[${"0 ".repeat(300_000)}]`], "/Root 1 0 R");
    const { item } = await upload(pdf, "many-objects.pdf");
    expect(item.parse_error).toContain(TOO_LARGE);
  });

  test("object stream entries that all point at one object count every parse", async () => {
    // 100,000 entries, each parsing the same 1,000-element array: 100 million objects.
    const entries = 100_000;
    const offsets = "1 0 ".repeat(entries);
    const data = deflateSync(Buffer.from(`${offsets}[${"0 ".repeat(1000)}]`));
    const pdf = buildPdf([
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [] /Count 0 >>",
      stream(`/Type /ObjStm /N ${entries} /First ${offsets.length} /Filter /FlateDecode`, data),
    ]);
    const { item } = await upload(pdf, "objstm-amplification.pdf");
    expect(item.parse_error).toContain(TOO_LARGE);
  });

  test("a cross-reference stream claiming billions of entries is not walked", async () => {
    // Without the guard pdf-lib would loop over /Size entries until the reader is killed.
    const xml = readFileSync(join(samplesDir, samplePdfs[0].replace(/\.pdf$/, ".xml")));
    const pdf = buildPdf([
      "<< /Type /Catalog /Pages 4 0 R /AF [2 0 R] >>",
      "<< /Type /Filespec /F (factur-x.xml) /EF << /F 3 0 R >> >>",
      stream("/Type /EmbeddedFile /Filter /FlateDecode", deflateSync(xml)),
      "<< /Type /Pages /Kids [] /Count 0 >>",
      stream("/Type /XRef /Size 2000000000 /W [1 4 2] /Root 1 0 R", ""),
    ]);
    const { item } = await upload(pdf, "xref-size.pdf");
    expect(item.parse_status).toBe("ok");
    expect(item.supplier_name).toBe("Anna Beispiel Design");
  });

  test("a name tree that loops back on itself ends", async () => {
    const pdf = buildPdf([
      "<< /Type /Catalog /Pages 4 0 R /Names << /EmbeddedFiles 2 0 R >> >>",
      "<< /Kids [3 0 R] >>",
      "<< /Kids [2 0 R 3 0 R] >>",
      "<< /Type /Pages /Kids [] /Count 0 >>",
    ]);
    const { item } = await upload(pdf, "loop.pdf");
    expect(item.parse_error).toContain(NO_XML);
  });

  test("the inbox still reads PDFs afterwards", async () => {
    const pdf = new Uint8Array(readFileSync(join(samplesDir, samplePdfs[1])));
    const { item } = await upload(concat([pdf, "\n% after\n"]), "after.pdf");
    expect(item.parse_status).toBe("ok");
  });
});
