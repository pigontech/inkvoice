import { writeFileSync } from "node:fs";
import { constants, inflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  type PDFObject,
  PDFObjectParser,
  PDFParser,
  PDFRawStream,
  PDFString,
} from "pdf-lib";

// Reads the XML from a received ZUGFeRD / Factur-X hybrid PDF. The inbox runs
// this file as a child process (see readPdfXml in einvoice-inbox.service.ts):
// the PDF comes in on stdin, the XML goes out on stdout, and the exit code
// says what happened. pdf-lib was written to create PDFs, not to read hostile
// ones: it inflates object streams without a size limit and caches every name
// and reference it meets in module-level maps that are never cleared. In a
// separate process that memory goes away when it exits, and a file that still
// gets the parser stuck is killed by the caller's timeout. On top of that the
// sizes and the number of parsed objects are capped here, and all
// decompression uses zlib with an output limit.

/** Largest PDF this reader opens (the inbox upload limit). */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
/** Largest embedded XML it returns (same as an inbound PEPPOL document). */
export const MAX_XML_BYTES = 10 * 1024 * 1024;
/** Decoded size of all object streams together; invoice PDFs need a few KB. */
const MAX_OBJECT_STREAM_BYTES = 8 * 1024 * 1024;
/**
 * Objects parsed at most. An invoice has a few hundred and a 60-page manual
 * about 26,000; 20 MB of tiny objects would be millions, over 1 GB of memory.
 */
const MAX_OBJECTS = 200_000;
/** Name tree nodes visited at most. */
const MAX_TREE_NODES = 1000;

/** Embedded file names of ZUGFeRD 2.x / Factur-X / XRechnung in ZUGFeRD (compared in lower case). */
const XML_FILE_NAMES = new Set(["factur-x.xml", "zugferd-invoice.xml", "xrechnung.xml"]);

export const EXIT = { ok: 0, no_xml: 3, encrypted: 4, too_large: 5 } as const;

export type ReadResult =
  | { status: "ok"; xml: Uint8Array }
  | { status: "no_xml" | "encrypted" | "too_large" | "unreadable" };

class LimitError extends Error {}

export async function readEmbeddedXml(pdf: Uint8Array): Promise<ReadResult> {
  if (pdf.length > MAX_PDF_BYTES) return { status: "too_large" };
  const limits = { exceeded: false, objects: 0, decoded: 0 };
  const restore = guardParser(limits);
  let context: Awaited<ReturnType<PDFParser["parseDocument"]>>;
  try {
    context = await PDFParser.forBytesWithOptions(pdf, Number.POSITIVE_INFINITY).parseDocument();
  } catch {
    return { status: limits.exceeded ? "too_large" : "unreadable" };
  } finally {
    restore();
  }
  if (limits.exceeded) return { status: "too_large" };
  // Embedded files of an encrypted PDF are encrypted too.
  if (context.trailerInfo.Encrypt) return { status: "encrypted" };
  const catalog = context.lookup(context.trailerInfo.Root);
  if (!(catalog instanceof PDFDict)) return { status: "unreadable" };

  try {
    for (const { key, spec } of fileSpecs(catalog)) {
      if (!isEinvoiceXml(spec, key)) continue;
      const ef = spec.lookup(PDFName.of("EF"));
      if (!(ef instanceof PDFDict)) continue;
      const file = [ef.lookup(PDFName.of("UF")), ef.lookup(PDFName.of("F"))].find(
        (s) => s instanceof PDFRawStream,
      );
      if (file instanceof PDFRawStream) return { status: "ok", xml: decode(file, MAX_XML_BYTES) };
    }
  } catch (err) {
    return { status: err instanceof LimitError ? "too_large" : "unreadable" };
  }
  return { status: "no_xml" };
}

/**
 * Wraps pdf-lib's object parser (for the top level and inside object streams)
 * until the returned function is called. Every object counts against
 * MAX_OBJECTS. pdf-lib also decodes object streams and cross-reference
 * streams while it parses, so they are caught here: object streams are
 * inflated within the limit and handed back decoded, and cross-reference
 * streams are emptied (pdf-lib reads only Root, Encrypt, Info and ID from
 * them, but would loop over /Size entries however little data they hold).
 */
function guardParser(state: { exceeded: boolean; objects: number; decoded: number }): () => void {
  const parseObject = PDFObjectParser.prototype.parseObject;
  PDFObjectParser.prototype.parseObject = function (this: PDFObjectParser): PDFObject {
    if (++state.objects > MAX_OBJECTS) {
      state.exceeded = true;
      throw new LimitError();
    }
    const object = parseObject.call(this);
    if (!(object instanceof PDFRawStream)) return object;
    const { dict } = object;
    const type = dict.lookup(PDFName.of("Type"));
    if (type === PDFName.of("XRef")) {
      dict.set(PDFName.of("Index"), dict.context.obj([]));
      dict.delete(PDFName.of("Filter"));
      return PDFRawStream.of(dict, new Uint8Array(0));
    }
    if (type === PDFName.of("ObjStm")) {
      let bytes: Uint8Array;
      try {
        bytes = decode(object, MAX_OBJECT_STREAM_BYTES - state.decoded);
      } catch (err) {
        if (err instanceof LimitError) state.exceeded = true;
        throw err;
      }
      state.decoded += bytes.length;
      dict.delete(PDFName.of("Filter"));
      dict.delete(PDFName.of("DecodeParms"));
      return PDFRawStream.of(dict, bytes);
    }
    return object;
  };
  return () => {
    PDFObjectParser.prototype.parseObject = parseObject;
  };
}

/** Unfiltered or FlateDecode streams only, inflated with an output limit. */
function decode(stream: PDFRawStream, limit: number): Uint8Array {
  if (limit <= 0) throw new LimitError();
  const filter = stream.dict.lookup(PDFName.of("Filter"));
  const filters: (PDFObject | undefined)[] = [];
  if (filter instanceof PDFArray) {
    for (let i = 0; i < filter.size(); i++) filters.push(filter.lookup(i));
  } else if (filter !== undefined) {
    filters.push(filter);
  }
  let bytes = stream.contents;
  for (const f of filters) {
    if (f !== PDFName.of("FlateDecode")) throw new Error("Unsupported stream filter");
    try {
      bytes = inflateSync(bytes, { maxOutputLength: limit, finishFlush: constants.Z_SYNC_FLUSH });
    } catch (err) {
      if ((err as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new LimitError();
      throw err;
    }
  }
  if (bytes.length > limit) throw new LimitError();
  return bytes;
}

/** File specifications from the EmbeddedFiles name tree, then the catalog's AF array. */
function* fileSpecs(catalog: PDFDict): Generator<{ key?: string; spec: PDFDict }> {
  const names = catalog.lookup(PDFName.of("Names"));
  const root = names instanceof PDFDict ? names.lookup(PDFName.of("EmbeddedFiles")) : undefined;
  if (root instanceof PDFDict) {
    const seen = new Set<PDFDict>([root]);
    const queue = [root];
    for (let node = queue.shift(); node; node = queue.shift()) {
      const pairs = node.lookup(PDFName.of("Names"));
      if (pairs instanceof PDFArray) {
        for (let i = 0; i + 1 < pairs.size(); i += 2) {
          const spec = pairs.lookup(i + 1);
          if (spec instanceof PDFDict) yield { key: text(pairs.lookup(i)), spec };
        }
      }
      const kids = node.lookup(PDFName.of("Kids"));
      if (!(kids instanceof PDFArray)) continue;
      for (let i = 0; i < kids.size(); i++) {
        const kid = kids.lookup(i);
        if (!(kid instanceof PDFDict) || seen.has(kid)) continue;
        if (seen.size >= MAX_TREE_NODES) throw new LimitError();
        seen.add(kid);
        queue.push(kid);
      }
    }
  }
  const af = catalog.lookup(PDFName.of("AF"));
  if (af instanceof PDFArray) {
    for (let i = 0; i < Math.min(af.size(), MAX_TREE_NODES); i++) {
      const spec = af.lookup(i);
      if (spec instanceof PDFDict) yield { spec };
    }
  }
}

function isEinvoiceXml(spec: PDFDict, key: string | undefined): boolean {
  return [key, text(spec.lookup(PDFName.of("UF"))), text(spec.lookup(PDFName.of("F")))].some(
    (name) => name !== undefined && XML_FILE_NAMES.has(name.trim().toLowerCase()),
  );
}

function text(object: PDFObject | undefined): string | undefined {
  return object instanceof PDFString || object instanceof PDFHexString
    ? object.decodeText()
    : undefined;
}

if (import.meta.main) {
  // Linux: should a file still exhaust memory, the kernel's OOM killer takes
  // this process rather than the server.
  try {
    writeFileSync("/proc/self/oom_score_adj", "1000");
  } catch {}
  // pdf-lib warns about every broken object; stdout must carry only the XML.
  console.log = console.info = console.warn = console.error = () => {};
  const result = await readEmbeddedXml(new Uint8Array(await Bun.stdin.arrayBuffer()));
  if (result.status === "ok") await Bun.write(Bun.stdout, result.xml);
  process.exitCode = result.status === "unreadable" ? 1 : EXIT[result.status];
}
