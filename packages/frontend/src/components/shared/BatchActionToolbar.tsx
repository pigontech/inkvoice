import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n";

interface BatchActionToolbarProps {
  selectedCount: number;
  onClear: () => void;
  children: ReactNode;
}

export function BatchActionToolbar({ selectedCount, onClear, children }: BatchActionToolbarProps) {
  const { t } = useTranslation();

  if (selectedCount === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2">
      <span className="text-sm font-medium">{t("batch.selected", { count: selectedCount })}</span>
      <Button variant="ghost" size="xs" onClick={onClear}>
        <X className="size-3" />
        {t("batch.clear")}
      </Button>
      <div className="mx-1 h-4 w-px bg-border" />
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}
