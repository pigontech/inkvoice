export interface CsvColumn<T> {
  header: string;
  key: keyof T & string;
  formatter?: (value: unknown, row: T) => string;
}

function escapeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[,"\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines: string[] = [columns.map((col) => escapeValue(col.header)).join(",")];

  for (const row of rows) {
    lines.push(
      columns
        .map((col) => {
          const raw = row[col.key];
          return escapeValue(col.formatter ? col.formatter(raw, row) : raw);
        })
        .join(","),
    );
  }

  return lines.join("\r\n");
}

export function csvHeaders(filename: string): Record<string, string> {
  const safe = filename.replace(/"/g, '\\"');
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${safe}"`,
  };
}
