import { CreditCard, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n";

export interface PaymentMethodListItem {
  id: string;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: number | boolean;
  created_at: string;
}

interface PaymentMethodListProps {
  methods: PaymentMethodListItem[];
  onRemove?: (id: string) => void;
  readOnly?: boolean;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Presentational list of a customer's saved cards. Used as-is in the client
 * portal (remove enabled) and the admin customer page (remove enabled, no
 * way to add a card from the admin side). `readOnly` hides the remove
 * control entirely for a future fully read-only placement.
 */
export function PaymentMethodList({ methods, onRemove, readOnly = false }: PaymentMethodListProps) {
  const { t } = useTranslation();

  if (methods.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("portal.saved_cards_empty")}</p>;
  }

  return (
    <ul className="space-y-2">
      {methods.map((m) => (
        <li
          key={m.id}
          className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/50 p-3"
        >
          <div className="flex items-center gap-2 min-w-0">
            <CreditCard className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium truncate">
                {t("portal.card_line", {
                  brand: capitalize(m.brand || ""),
                  last4: m.last4 || "----",
                  month: String(m.exp_month ?? "").padStart(2, "0"),
                  year: String(m.exp_year ?? ""),
                })}
              </span>
              {!!m.is_default && (
                <Badge variant="secondary" className="text-[10px]">
                  {t("templates.default")}
                </Badge>
              )}
            </div>
          </div>
          {!readOnly && onRemove && (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => onRemove(m.id)}
              aria-label={t("portal.remove_card")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
