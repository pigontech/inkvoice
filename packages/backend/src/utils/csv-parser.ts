/**
 * Tiny RFC 4180-ish CSV parser. Handles:
 *   - quoted fields containing commas, newlines, and escaped quotes ("")
 *   - mixed CRLF / LF line endings
 *   - blank lines (skipped)
 *
 * Trade-off: no streaming. Accepts the whole input as a string. Adequate for
 * import payloads up to a few MB. If we ever import gigabyte CSVs we'll need
 * a streaming parser.
 */
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(input: string): ParsedCsv {
  // Strip BOM if present (Excel exports often include one)
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote ""
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"' && field.length === 0) {
      inQuotes = true;
      i++;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }

    if (ch === "\r" || ch === "\n") {
      row.push(field);
      field = "";
      // Skip \r\n as one line break
      if (ch === "\r" && text[i + 1] === "\n") i++;
      // Skip empty lines
      if (row.length > 1 || row[0] !== "") {
        rows.push(row);
      }
      row = [];
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  // Last field / row (no trailing newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = rows[0].map((h) => h.trim());
  return { headers, rows: rows.slice(1) };
}
