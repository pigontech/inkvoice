/** Matches `updateInvoice` in the backend: only draft invoices accept PUT /invoices/:id */
export function isInvoiceFormEditable(status: string): boolean {
  return status === "draft";
}

export const STATUS_COLORS: Record<string, string> = {
  draft: "border-dashed border-border-strong bg-transparent text-secondary-foreground",
  sent: "bg-info-soft text-info",
  paid: "bg-success-soft text-success",
  partially_paid: "bg-warning-soft text-warning",
  overdue: "bg-destructive-soft text-destructive",
  voided: "bg-muted text-muted-foreground line-through",
  complete: "bg-done-soft text-done",
  // quotes
  accepted: "bg-success-soft text-success",
  rejected: "bg-destructive-soft text-destructive",
  expired: "bg-warning-soft text-warning",
  converted: "bg-done-soft text-done",
  // recurring invoices
  active: "bg-success-soft text-success",
  paused: "bg-muted text-secondary-foreground",
  completed: "bg-done-soft text-done",
};

export interface Currency {
  code: string;
  name: string;
  symbol: string;
}

export const CURRENCIES: Currency[] = [
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥" },
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF" },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥" },
  { code: "SEK", name: "Swedish Krona", symbol: "kr" },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$" },
  { code: "MXN", name: "Mexican Peso", symbol: "MX$" },
  { code: "SGD", name: "Singapore Dollar", symbol: "S$" },
  { code: "HKD", name: "Hong Kong Dollar", symbol: "HK$" },
  { code: "NOK", name: "Norwegian Krone", symbol: "kr" },
  { code: "KRW", name: "South Korean Won", symbol: "₩" },
  { code: "TRY", name: "Turkish Lira", symbol: "₺" },
  { code: "INR", name: "Indian Rupee", symbol: "₹" },
  { code: "RUB", name: "Russian Ruble", symbol: "₽" },
  { code: "BRL", name: "Brazilian Real", symbol: "R$" },
  { code: "ZAR", name: "South African Rand", symbol: "R" },
  { code: "DKK", name: "Danish Krone", symbol: "kr" },
  { code: "PLN", name: "Polish Zloty", symbol: "zł" },
  { code: "TWD", name: "Taiwan Dollar", symbol: "NT$" },
  { code: "THB", name: "Thai Baht", symbol: "฿" },
  { code: "MYR", name: "Malaysian Ringgit", symbol: "RM" },
  { code: "IDR", name: "Indonesian Rupiah", symbol: "Rp" },
  { code: "PHP", name: "Philippine Peso", symbol: "₱" },
  { code: "CZK", name: "Czech Koruna", symbol: "Kč" },
  { code: "ILS", name: "Israeli Shekel", symbol: "₪" },
  { code: "CLP", name: "Chilean Peso", symbol: "CL$" },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ" },
  { code: "SAR", name: "Saudi Riyal", symbol: "﷼" },
  { code: "COP", name: "Colombian Peso", symbol: "CO$" },
  { code: "ARS", name: "Argentine Peso", symbol: "AR$" },
  { code: "VND", name: "Vietnamese Dong", symbol: "₫" },
];
