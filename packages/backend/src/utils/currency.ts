import { logger } from "./logger";

function getLocaleForNumberFormat(numberFormat?: string): string {
  switch (numberFormat) {
    case "1.000,00":
      return "de-DE";
    case "1 000,00":
      return "fr-FR";
    case "1,000.00":
    default:
      return "en-US";
  }
}

// Documents predating the currency dropdown can carry a half-typed code like
// "EU", which Intl rejects. Render the amount with the code appended rather
// than throwing, and log it so the bad data is discoverable.
function formatFallback(amount: number, currency: string, locale: string): string {
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    formatted = amount.toFixed(2);
  }
  return `${formatted} ${currency}`.trim();
}

export function formatCurrency(
  amount: number,
  currency = "USD",
  numberFormat?: string,
  localeOverride?: string,
): string {
  const locale = localeOverride || getLocaleForNumberFormat(numberFormat);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch (err) {
    logger.warn({ currency, locale, err }, "Falling back on unformattable currency");
    return formatFallback(amount, currency, locale);
  }
}

/**
 * Decimal places a payment in this currency can carry, from ISO 4217 via Intl
 * (JPY 0, USD 2). Capped at 2 because amounts are stored to cents. An unknown
 * or malformed code counts as 2.
 */
export function currencyDecimals(currency: string): number {
  try {
    const { maximumFractionDigits } = new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions();
    return Math.min(maximumFractionDigits ?? 2, 2);
  } catch {
    return 2;
  }
}

/**
 * What is still owed on an invoice. Totals are computed to cents in every
 * currency, so a JPY total can carry a fractional yen (for example from a
 * percentage tax). A remainder of at most half the currency's smallest unit
 * cannot be paid in that currency, so it counts as nothing owed.
 */
export function outstandingBalance(total: number, paid: number, currency: string): number {
  const balance = total - paid;
  const halfUnit = 0.5 * 10 ** -currencyDecimals(currency);
  return balance <= halfUnit + 1e-9 ? 0 : balance;
}
