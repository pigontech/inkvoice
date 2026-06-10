import { Bookmark, Check, Plus, Star, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useTranslation } from "@/i18n";

/**
 * A filter preset captures the URL segment / status, optional date range, and
 * optional search term. Customer filter is intentionally excluded — it usually
 * comes from a navigation context, not a saved view.
 */
export interface InvoiceFilterPreset {
  id: string;
  name: string;
  /** URL segment for status: "all", "draft", "sent", "overdue", etc. */
  segment: string;
  date_from?: string;
  date_to?: string;
  search?: string;
}

export interface CurrentFilters {
  segment: string;
  date_from?: string;
  date_to?: string;
  search?: string;
}

interface BuiltinPreset {
  id: string;
  nameKey: string;
  resolve: (now: Date) => CurrentFilters;
}

const BUILTIN_PRESETS: BuiltinPreset[] = [
  {
    id: "_builtin_drafts",
    nameKey: "saved_filters.preset_drafts",
    resolve: () => ({ segment: "draft" }),
  },
  {
    id: "_builtin_outstanding",
    nameKey: "saved_filters.preset_outstanding",
    resolve: () => ({ segment: "sent" }),
  },
  {
    id: "_builtin_overdue",
    nameKey: "saved_filters.preset_overdue",
    resolve: () => ({ segment: "overdue" }),
  },
  {
    id: "_builtin_paid_this_month",
    nameKey: "saved_filters.preset_paid_this_month",
    resolve: (now) => {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return {
        segment: "paid",
        date_from: toIso(start),
        date_to: toIso(end),
      };
    },
  },
  {
    id: "_builtin_paid_last_month",
    nameKey: "saved_filters.preset_paid_last_month",
    resolve: (now) => {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        segment: "paid",
        date_from: toIso(start),
        date_to: toIso(end),
      };
    },
  },
];

function toIso(d: Date): string {
  return d.toISOString().split("T")[0];
}

function presetsMatch(a: CurrentFilters, b: CurrentFilters): boolean {
  return (
    a.segment === b.segment &&
    (a.date_from || "") === (b.date_from || "") &&
    (a.date_to || "") === (b.date_to || "") &&
    (a.search || "") === (b.search || "")
  );
}

function hasActiveFilters(f: CurrentFilters): boolean {
  return f.segment !== "all" || !!f.date_from || !!f.date_to || !!f.search;
}

interface Props {
  /** Storage key — different lists use different keys to keep presets scoped. */
  storageKey: string;
  current: CurrentFilters;
  onApply: (preset: CurrentFilters) => void;
}

export function SavedFiltersMenu({ storageKey, current, onApply }: Props) {
  const { t } = useTranslation();
  const [presets, setPresets] = usePersistentState<InvoiceFilterPreset[]>(storageKey, []);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [draftName, setDraftName] = useState("");

  const now = useMemo(() => new Date(), []);
  const builtins = useMemo(
    () => BUILTIN_PRESETS.map((p) => ({ id: p.id, name: t(p.nameKey), filters: p.resolve(now) })),
    [t, now],
  );

  const activeBuiltinId = useMemo(() => {
    return builtins.find((b) => presetsMatch(current, b.filters))?.id ?? null;
  }, [builtins, current]);

  const activeCustomId = useMemo(() => {
    return (
      presets.find((p) =>
        presetsMatch(current, {
          segment: p.segment,
          date_from: p.date_from,
          date_to: p.date_to,
          search: p.search,
        }),
      )?.id ?? null
    );
  }, [presets, current]);

  const handleSave = () => {
    const name = draftName.trim();
    if (!name) return;
    setPresets((prev) => [
      ...prev,
      {
        id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        segment: current.segment,
        date_from: current.date_from,
        date_to: current.date_to,
        search: current.search,
      },
    ]);
    setDraftName("");
    setSaveDialogOpen(false);
  };

  const handleDelete = (id: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background hover:bg-accent text-sm font-medium transition-colors">
          <Bookmark className="h-3.5 w-3.5" />
          {t("saved_filters.button")}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>{t("saved_filters.builtin_label")}</DropdownMenuLabel>
          {builtins.map((b) => (
            <DropdownMenuItem
              key={b.id}
              onSelect={() => onApply(b.filters)}
              className="flex items-center gap-2"
            >
              <Star className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1 truncate">{b.name}</span>
              {activeBuiltinId === b.id && <Check className="h-3.5 w-3.5" />}
            </DropdownMenuItem>
          ))}

          {presets.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t("saved_filters.your_label")}</DropdownMenuLabel>
              {presets.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onSelect={() =>
                    onApply({
                      segment: p.segment,
                      date_from: p.date_from,
                      date_to: p.date_to,
                      search: p.search,
                    })
                  }
                  className="flex items-center gap-2 group"
                >
                  <Bookmark className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="flex-1 truncate">{p.name}</span>
                  {activeCustomId === p.id && <Check className="h-3.5 w-3.5 mr-1" />}
                  <button
                    type="button"
                    aria-label={t("saved_filters.delete_preset")}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDelete(p.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuItem>
              ))}
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!hasActiveFilters(current)}
            onSelect={(e) => {
              e.preventDefault();
              setSaveDialogOpen(true);
            }}
            className="flex items-center gap-2"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("saved_filters.save_current")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("saved_filters.dialog_title")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder={t("saved_filters.name_placeholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={handleSave} disabled={!draftName.trim()}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
