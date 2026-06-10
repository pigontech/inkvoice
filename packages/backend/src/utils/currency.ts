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

export function formatCurrency(
  amount: number,
  currency = "USD",
  numberFormat?: string,
  localeOverride?: string,
): string {
  const locale = localeOverride || getLocaleForNumberFormat(numberFormat);
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
}
