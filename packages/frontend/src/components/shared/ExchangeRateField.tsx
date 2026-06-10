import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { useTranslation } from "@/i18n";
import { formatCurrency } from "@/lib/utils";

interface Props {
  fromCurrency: string;
  baseCurrency: string;
  rate: number;
  onChange: (rate: number) => void;
  /** Native amount, used to preview the base-currency equivalent. */
  amount?: number;
}

/**
 * Manual exchange-rate entry with a one-click ECB fetch. Renders nothing when
 * the row is already in the base currency (rate is implicitly 1).
 */
export function ExchangeRateField({ fromCurrency, baseCurrency, rate, onChange, amount }: Props) {
  const { t } = useTranslation();
  const [fetching, setFetching] = useState(false);

  if (!fromCurrency || fromCurrency.toUpperCase() === baseCurrency.toUpperCase()) return null;

  const handleFetch = async () => {
    setFetching(true);
    try {
      const res = await api.getExchangeRate(fromCurrency, baseCurrency);
      if (res.data.rate != null) {
        onChange(res.data.rate);
        toast.success(t("invoices.rate_fetched"));
      } else {
        toast.error(t("invoices.rate_unavailable"));
      }
    } catch {
      toast.error(t("invoices.rate_unavailable"));
    } finally {
      setFetching(false);
    }
  };

  return (
    <FormField
      label={t("invoices.exchange_rate")}
      hint={t("invoices.exchange_rate_hint", { from: fromCurrency, base: baseCurrency })}
    >
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <NumberInput value={rate} min={0} decimals={6} onValueChange={onChange} />
        </div>
        <Button type="button" variant="outline" size="sm" disabled={fetching} onClick={handleFetch}>
          <RefreshCw className={`h-4 w-4 ${fetching ? "animate-spin" : ""}`} />
          {t("invoices.fetch_rate")}
        </Button>
      </div>
      {amount != null && amount > 0 && (
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {t("invoices.base_equivalent", {
            amount: formatCurrency(amount * (rate || 0), baseCurrency),
          })}
        </p>
      )}
    </FormField>
  );
}
