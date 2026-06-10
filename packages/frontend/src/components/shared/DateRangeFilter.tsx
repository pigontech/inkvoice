import {
  endOfMonth,
  endOfQuarter,
  format,
  startOfMonth,
  startOfQuarter,
  subMonths,
  subQuarters,
} from "date-fns";
import { CalendarDays, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/i18n";
import {
  endOfFiscalYear,
  parseFiscalYearStartMonth,
  startOfFiscalYear,
  subFiscalYears,
} from "@/lib/fiscal-year";
import { useSettingsStore } from "@/stores/settings.store";

type DateRange = { from?: string; to?: string };

interface DateRangeFilterProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

const fmt = (d: Date) => format(d, "yyyy-MM-dd");

function makePresets(t: (key: string) => string, fiscalStartMonth: number) {
  return [
    { value: "all", label: t("date_range.all_time"), range: () => ({}) as DateRange },
    {
      value: "this-month",
      label: t("date_range.this_month"),
      range: () => {
        const now = new Date();
        return { from: fmt(startOfMonth(now)), to: fmt(endOfMonth(now)) };
      },
    },
    {
      value: "last-month",
      label: t("date_range.last_month"),
      range: () => {
        const d = subMonths(new Date(), 1);
        return { from: fmt(startOfMonth(d)), to: fmt(endOfMonth(d)) };
      },
    },
    {
      value: "this-quarter",
      label: t("date_range.this_quarter"),
      range: () => {
        const now = new Date();
        return { from: fmt(startOfQuarter(now)), to: fmt(endOfQuarter(now)) };
      },
    },
    {
      value: "last-quarter",
      label: t("date_range.last_quarter"),
      range: () => {
        const d = subQuarters(new Date(), 1);
        return { from: fmt(startOfQuarter(d)), to: fmt(endOfQuarter(d)) };
      },
    },
    {
      value: "this-year",
      label: t("date_range.this_year"),
      range: () => {
        const now = new Date();
        return {
          from: fmt(startOfFiscalYear(now, fiscalStartMonth)),
          to: fmt(endOfFiscalYear(now, fiscalStartMonth)),
        };
      },
    },
    {
      value: "last-year",
      label: t("date_range.last_year"),
      range: () => {
        const d = subFiscalYears(new Date(), fiscalStartMonth, 1);
        return {
          from: fmt(startOfFiscalYear(d, fiscalStartMonth)),
          to: fmt(endOfFiscalYear(d, fiscalStartMonth)),
        };
      },
    },
    { value: "custom", label: t("date_range.custom_range"), range: () => ({}) as DateRange },
  ];
}

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  const { t } = useTranslation();
  const fiscalStartMonth = useSettingsStore((s) =>
    parseFiscalYearStartMonth(s.settings.fiscal_year_start_month),
  );
  const PRESETS = useMemo(() => makePresets(t, fiscalStartMonth), [t, fiscalStartMonth]);

  const [preset, setPreset] = useState(() => {
    if (!value.from && !value.to) return "all";
    for (const p of PRESETS) {
      if (p.value === "all" || p.value === "custom") continue;
      const r = p.range();
      if (r.from === value.from && r.to === value.to) return p.value;
    }
    return "custom";
  });

  const isCustom = preset === "custom";
  const hasFilter = !!(value.from || value.to);

  const selectedLabel = useMemo(
    () => PRESETS.find((p) => p.value === preset)?.label ?? t("date_range.all_time"),
    [preset, PRESETS, t],
  );

  const handlePreset = (v: string) => {
    setPreset(v);
    if (v === "custom") return;
    const p = PRESETS.find((p) => p.value === v);
    if (p) onChange(p.range());
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={preset} onValueChange={(v) => v && handlePreset(v)}>
        <SelectTrigger size="sm" className="gap-1.5">
          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
          <SelectValue placeholder={t("date_range.placeholder")}>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start">
          {PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isCustom && (
        <>
          <Input
            type="date"
            value={value.from ?? ""}
            onChange={(e) => onChange({ ...value, from: e.target.value || undefined })}
            className="h-7 w-36 text-xs"
            aria-label={t("date_range.from_date")}
          />
          <span className="text-xs text-muted-foreground">{t("common.to")}</span>
          <Input
            type="date"
            value={value.to ?? ""}
            onChange={(e) => onChange({ ...value, to: e.target.value || undefined })}
            className="h-7 w-36 text-xs"
            aria-label={t("date_range.to_date")}
          />
        </>
      )}

      {hasFilter && !isCustom && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={t("date_range.clear_filter")}
          onClick={() => {
            setPreset("all");
            onChange({});
          }}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
