import type { CsvColumn } from "./csv";

/**
 * New Zealand businesses (business locale en-NZ) say "GST" rather than "tax",
 * "GST Number" rather than "Tax ID", and "financial year" rather than "fiscal year".
 */
export function isNzBusiness(settings: Record<string, string>): boolean {
  return (settings.locale || "").toLowerCase() === "en-nz";
}

/** Rewrite generic tax wording into NZ wording. */
export function toNzTerms(text: string): string {
  return text
    .replace(/\bTax ID\b/g, "GST Number")
    .replace(/\bTaxable Amount\b/g, "Amount excl. GST")
    .replace(/\bTax\b/g, "GST")
    .replace(/\btax\b/g, "GST")
    .replace(/\bFiscal\b/g, "Financial")
    .replace(/\bfiscal\b/g, "financial");
}

/** CSV columns with NZ header wording when the business is in New Zealand. */
export function regionalColumns<T>(
  columns: CsvColumn<T>[],
  settings: Record<string, string>,
): CsvColumn<T>[] {
  if (!isNzBusiness(settings)) return columns;
  return columns.map((col) => ({ ...col, header: toNzTerms(col.header) }));
}
