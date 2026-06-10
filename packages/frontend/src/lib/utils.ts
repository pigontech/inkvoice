import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount);
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
