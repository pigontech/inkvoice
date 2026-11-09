import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Settings echo the locale field on every keystroke, so a half-typed value
// like "de-" reaches Intl, which throws on invalid tags. Fall back instead.
export function safeLocale(locale: string | null | undefined, fallback = "en-US"): string {
  const tag = (locale || "").trim();
  if (!tag) return fallback;
  try {
    return Intl.getCanonicalLocales(tag)[0] || fallback;
  } catch {
    return fallback;
  }
}

function getCurrentLocale(): string {
  try {
    const lang = localStorage.getItem("inkvoice-lang") || "en";
    const localeMap: Record<string, string> = { en: "en-US", tr: "tr-TR" };
    return localeMap[lang] || "en-US";
  } catch {
    return "en-US";
  }
}

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

export function formatCurrency(amount: number, currency = "USD", numberFormat?: string): string {
  const locale = numberFormat ? getLocaleForNumberFormat(numberFormat) : getCurrentLocale();
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    // Documents predating the currency dropdown can carry a half-typed code
    // like "EU", which Intl rejects — render the amount with the code appended
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
}

export function formatDate(dateString: string, dateFormat?: string): string {
  // Date-only strings must be parsed as a local date — new Date("YYYY-MM-DD")
  // is midnight UTC, which renders as the previous day west of UTC.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  const d = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(dateString);
  if (dateFormat) {
    const yyyy = d.getFullYear().toString();
    const mm = (d.getMonth() + 1).toString().padStart(2, "0");
    const dd = d.getDate().toString().padStart(2, "0");
    return dateFormat.replace("YYYY", yyyy).replace("MM", mm).replace("DD", dd);
  }
  return d.toLocaleDateString(getCurrentLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
