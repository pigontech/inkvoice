// Minimal zip writer (stored mode, no compression).
// We avoid pulling in jszip/adm-zip — invoice HTML files compress poorly
// and the spec we need is small. Implements ZIP64-free single-disk archives.

import { crc32 } from "node:zlib";

export interface ZipEntry {
  /** File name within the archive (use forward slashes). */
  name: string;
  /** File contents — string is encoded as UTF-8. */
  data: Uint8Array | string;
}

const enc = new TextEncoder();

function dosDateTime(d: Date): { date: number; time: number } {
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  return { date, time };
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}
function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

/**
 * Build a ZIP archive from the given entries. Stored mode only — fine for
 * mostly-text payloads where compression savings are marginal.
 */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const now = new Date();
  const { date: dosDate, time: dosTime } = dosDateTime(now);

  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const data = typeof entry.data === "string" ? enc.encode(entry.data) : entry.data;
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(data) >>> 0;

    // Local file header
    const lfh = new Uint8Array(30 + nameBytes.length);
    const lfhView = new DataView(lfh.buffer);
    writeU32(lfhView, 0, 0x04034b50);
    writeU16(lfhView, 4, 20); // version needed
    writeU16(lfhView, 6, 0); // flags
    writeU16(lfhView, 8, 0); // compression: stored
    writeU16(lfhView, 10, dosTime);
    writeU16(lfhView, 12, dosDate);
    writeU32(lfhView, 14, crc);
    writeU32(lfhView, 18, data.length); // compressed size = uncompressed (stored)
    writeU32(lfhView, 22, data.length);
    writeU16(lfhView, 26, nameBytes.length);
    writeU16(lfhView, 28, 0); // extra field length
    lfh.set(nameBytes, 30);

    localChunks.push(lfh, data);

    // Central directory header
    const cdh = new Uint8Array(46 + nameBytes.length);
    const cdhView = new DataView(cdh.buffer);
    writeU32(cdhView, 0, 0x02014b50);
    writeU16(cdhView, 4, 20); // version made by
    writeU16(cdhView, 6, 20); // version needed
    writeU16(cdhView, 8, 0); // flags
    writeU16(cdhView, 10, 0); // compression
    writeU16(cdhView, 12, dosTime);
    writeU16(cdhView, 14, dosDate);
    writeU32(cdhView, 16, crc);
    writeU32(cdhView, 20, data.length);
    writeU32(cdhView, 24, data.length);
    writeU16(cdhView, 28, nameBytes.length);
    writeU16(cdhView, 30, 0); // extra field
    writeU16(cdhView, 32, 0); // comment length
    writeU16(cdhView, 34, 0); // disk number
    writeU16(cdhView, 36, 0); // internal attrs
    writeU32(cdhView, 38, 0); // external attrs
    writeU32(cdhView, 42, offset); // local header offset
    cdh.set(nameBytes, 46);

    centralChunks.push(cdh);

    offset += lfh.length + data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of centralChunks) centralSize += c.length;

  // End of central directory
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  writeU32(eocdView, 0, 0x06054b50);
  writeU16(eocdView, 4, 0); // disk number
  writeU16(eocdView, 6, 0); // disk where CD starts
  writeU16(eocdView, 8, entries.length);
  writeU16(eocdView, 10, entries.length);
  writeU32(eocdView, 12, centralSize);
  writeU32(eocdView, 16, centralStart);
  writeU16(eocdView, 20, 0); // comment length

  const totalSize = centralStart + centralSize + eocd.length;
  const out = new Uint8Array(totalSize);
  let pos = 0;
  for (const chunk of localChunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  for (const chunk of centralChunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  out.set(eocd, pos);
  return out;
}
