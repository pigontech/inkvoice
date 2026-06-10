import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "@/i18n";
import { formatRelativeTime } from "@/lib/format-relative";
import { cn } from "@/lib/utils";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface SaveStatusIndicatorProps {
  status: SaveStatus;
  lastSavedAt: number | null;
  className?: string;
}

export function SaveStatusIndicator({ status, lastSavedAt, className }: SaveStatusIndicatorProps) {
  const { t } = useTranslation();
  const [tick, setTick] = useState(0);

  // Re-render every 30s so the relative time stays fresh.
  useEffect(() => {
    if (status !== "saved" || lastSavedAt === null) return;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [status, lastSavedAt]);

  // touch tick to satisfy the linter — value is intentionally only used to trigger renders
  void tick;

  if (status === "saving") {
    return (
      <span
        className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}
        aria-live="polite"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("common.saving_ellipsis")}
      </span>
    );
  }

  if (status === "error") {
    return (
      <span
        className={cn("inline-flex items-center gap-1.5 text-xs text-destructive", className)}
        aria-live="polite"
      >
        <AlertCircle className="h-3 w-3" />
        {t("common.save_failed")}
      </span>
    );
  }

  if (status === "saved" && lastSavedAt !== null) {
    return (
      <span
        className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}
        aria-live="polite"
      >
        <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
        {t("common.saved_at", { when: formatRelativeTime(lastSavedAt, t) })}
      </span>
    );
  }

  return null;
}
