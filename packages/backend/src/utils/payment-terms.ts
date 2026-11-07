/**
 * The payment-terms picker stores its presets as English text ("Due on
 * receipt", "Net 14"), so stored invoices, the API and the due-date
 * calculation keep one stable value. Documents print a preset in their own
 * language instead; custom terms are printed exactly as typed.
 *
 * Languages without an entry here (English included) print the stored text.
 */
const PRESET_TEXT: Record<string, { onReceipt: string; net: (days: number) => string }> = {
  de: {
    onReceipt: "Zahlbar sofort ohne Abzug",
    net: (days) => `Zahlbar innerhalb von ${days} ${days === 1 ? "Tag" : "Tagen"} ohne Abzug`,
  },
  tr: {
    onReceipt: "Fatura alındığında ödenir",
    net: (days) => `Fatura tarihinden itibaren ${days} gün içinde ödenir`,
  },
  es: {
    onReceipt: "Pago a la recepción de la factura",
    net: (days) => `Pago a ${days} ${days === 1 ? "día" : "días"}`,
  },
  fr: {
    onReceipt: "Paiement à réception de la facture",
    net: (days) => `Paiement à ${days} ${days === 1 ? "jour" : "jours"}`,
  },
};

/**
 * Payment terms as a document in `locale` (a BCP 47 tag such as "de-DE")
 * prints them. The same strings count as presets as in the frontend's
 * `paymentTermsToDays`: "Due on receipt" and "Net <days>", in any case.
 */
export function localizePaymentTerms(
  terms: string | null | undefined,
  locale: string | null | undefined,
): string | null {
  if (!terms) return null;
  const text = PRESET_TEXT[(locale || "").slice(0, 2).toLowerCase()];
  if (!text) return terms;
  const trimmed = terms.trim();
  if (/^due on receipt$/i.test(trimmed)) return text.onReceipt;
  const net = trimmed.match(/^net\s+(\d+)$/i);
  return net ? text.net(Number.parseInt(net[1], 10)) : terms;
}
