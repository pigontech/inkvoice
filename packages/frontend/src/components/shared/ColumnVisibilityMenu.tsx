import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useTranslation } from "@/i18n";

export interface ColumnDef {
  key: string;
  label: string;
  /** Required columns can't be hidden. */
  required?: boolean;
}

interface Props {
  storageKey: string;
  columns: ColumnDef[];
  /** Default-hidden column keys (only used the first time the user opens this menu). */
  defaultHidden?: string[];
}

export function useColumnVisibility(
  storageKey: string,
  defaultHidden: string[] = [],
): {
  isVisible: (key: string) => boolean;
  toggle: (key: string) => void;
  setHidden: (next: string[]) => void;
  hidden: string[];
} {
  const [hidden, setHidden] = usePersistentState<string[]>(storageKey, defaultHidden);
  return {
    isVisible: (key) => !hidden.includes(key),
    toggle: (key) =>
      setHidden((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key])),
    setHidden,
    hidden,
  };
}

export function ColumnVisibilityMenu({ storageKey, columns, defaultHidden = [] }: Props) {
  const { t } = useTranslation();
  const { isVisible, toggle } = useColumnVisibility(storageKey, defaultHidden);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={t("common.columns")}
            title={t("common.columns")}
          />
        }
      >
        <Columns3 className="h-3.5 w-3.5 mr-1.5" />
        {t("common.columns")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">
          {t("common.toggle_columns")}
        </div>
        <DropdownMenuSeparator />
        {columns.map((col) => (
          <DropdownMenuCheckboxItem
            key={col.key}
            checked={isVisible(col.key)}
            disabled={col.required}
            closeOnClick={false}
            onCheckedChange={() => !col.required && toggle(col.key)}
          >
            {col.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
