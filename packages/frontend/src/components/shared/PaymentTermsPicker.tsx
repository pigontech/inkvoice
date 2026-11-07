import { Input } from "@/components/ui/input";
import { type TFunction, useTranslation } from "@/i18n";

// Stored as this English text whatever the UI language: the backend prints a
// preset in the invoice's language (utils/payment-terms.ts).
const PRESET_VALUES = ["Due on receipt", "Net 7", "Net 14", "Net 30", "Net 60"] as const;
const CUSTOM_SENTINEL = "__custom__";

/** A stored preset in the UI language; custom terms as typed. */
export function paymentTermsLabel(terms: string, t: TFunction): string {
  switch (terms) {
    case "Due on receipt":
      return t("settings.payment_terms_due_on_receipt");
    case "Net 7":
      return t("settings.payment_terms_net_7");
    case "Net 14":
      return t("settings.payment_terms_net_14");
    case "Net 30":
      return t("settings.payment_terms_net_30");
    case "Net 60":
      return t("settings.payment_terms_net_60");
    default:
      return terms;
  }
}

/**
 * Days until due for a recognised payment-terms string: "Due on receipt" → 0,
 * "Net N" → N. Returns null for empty or custom terms (no auto-computation).
 */
export function paymentTermsToDays(terms: string): number | null {
  const trimmed = terms.trim();
  if (/^due on receipt$/i.test(trimmed)) return 0;
  const match = trimmed.match(/^net\s+(\d+)$/i);
  return match ? parseInt(match[1], 10) : null;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function PaymentTermsPicker({ value, onChange }: Props) {
  const { t } = useTranslation();
  const isPreset = (PRESET_VALUES as readonly string[]).includes(value);
  const mode = !value ? "" : isPreset ? value : CUSTOM_SENTINEL;

  return (
    <div className="flex gap-2">
      <select
        value={mode}
        onChange={(e) => {
          const next = e.target.value;
          if (next === "") onChange("");
          else if (next === CUSTOM_SENTINEL) onChange(value && !isPreset ? value : " ");
          else onChange(next);
        }}
        className="form-select flex-1"
      >
        <option value="">{t("settings.payment_terms_none")}</option>
        {PRESET_VALUES.map((preset) => (
          <option key={preset} value={preset}>
            {paymentTermsLabel(preset, t)}
          </option>
        ))}
        <option value={CUSTOM_SENTINEL}>{t("settings.payment_terms_custom")}</option>
      </select>
      {mode === CUSTOM_SENTINEL && (
        <Input
          className="flex-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
        />
      )}
    </div>
  );
}
