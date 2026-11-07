import type { TFunction } from "@/i18n";

/** A validation issue from the e-invoice emit and check endpoints. */
export interface EinvoiceIssue {
  severity: string;
  code: string;
  /** English text from the API. */
  message: string;
  /** The values quoted in `message`. */
  params?: Record<string, string>;
}

/**
 * The issue in the UI language (`einvoice.issue.<code>`), or the API's
 * English message for a code the app has no translation for.
 */
export function einvoiceIssueText(issue: EinvoiceIssue, t: TFunction): string {
  const key = `einvoice.issue.${issue.code}`;
  const text = t(key, issue.params);
  return text === key ? issue.message : text;
}
