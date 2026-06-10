import { Clock, Menu, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCommandPalette } from "@/components/CommandPalette";
import { NotificationsDropdown } from "@/components/layout/NotificationsDropdown";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/i18n";
import {
  clearRecentlyViewed,
  getRecentlyViewed,
  type RecentEntity,
  subscribeRecentlyViewed,
} from "@/lib/recently-viewed";
import { useSettingsStore } from "@/stores/settings.store";

interface HeaderProps {
  onToggleSidebar: () => void;
}

const PATH_KEY: Record<string, string> = {
  "": "nav.dashboard",
  invoices: "nav.invoices",
  quotes: "nav.quotes",
  recurring: "nav.recurring",
  customers: "nav.customers",
  products: "nav.products",
  reports: "nav.reports",
  settings: "nav.settings",
  users: "nav.users",
  activity: "nav.activity",
  templates: "nav.templates",
};

function entityPath(e: RecentEntity): string {
  switch (e.type) {
    case "invoice":
      return `/invoices/${e.id}`;
    case "quote":
      return `/quotes/${e.id}`;
    case "customer":
      return `/customers/${e.id}`;
    case "product":
      return `/products/${e.id}`;
  }
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/i.test(navigator.platform);

export function Header({ onToggleSidebar }: HeaderProps) {
  const { settings } = useSettingsStore();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const openPalette = useCommandPalette((s) => s.setOpen);
  const isDemoMode = settings.demo_mode === "true";
  const [recent, setRecent] = useState<RecentEntity[]>(() => getRecentlyViewed());

  useEffect(() => {
    return subscribeRecentlyViewed(() => setRecent(getRecentlyViewed()));
  }, []);

  const crumb = useMemo(() => {
    const segments = location.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return t("nav.dashboard");
    const root = segments[0];
    const key = PATH_KEY[root];
    return key ? t(key) : root.charAt(0).toUpperCase() + root.slice(1);
  }, [location.pathname, t]);

  return (
    <header className="flex flex-col">
      {isDemoMode && (
        <div className="mx-4 mt-4 mb-0 flex items-center justify-center gap-2 h-7 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 text-xs font-medium border border-amber-300/40 dark:border-amber-700/30">
          {t("common.demo_mode")} — {t("common.demo_mode_notice")}
        </div>
      )}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 h-12 px-3 rounded-lg border border-black/[0.10] dark:border-white/[0.08] bg-white/70 dark:bg-[oklch(0.10_0.025_265/0.65)] backdrop-blur-xl backdrop-saturate-[1.3] shadow-[0_6px_18px_-8px_rgb(0_0_0/0.10),inset_0_0_0_1px_rgb(0_0_0/0.04)] dark:shadow-[0_6px_18px_-8px_rgb(0_0_0/0.7),inset_0_0_0_1px_rgb(255_255_255/0.04)]">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleSidebar}
            aria-label={t("header.toggle_sidebar")}
          >
            <Menu className="h-4 w-4" />
          </Button>
          <div className="font-mono text-[11px] uppercase tracking-[0.10em] text-muted-foreground/80 truncate">
            Inkvoice <span className="opacity-60 mx-1">/</span> {crumb}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => openPalette(true)}
              aria-label={t("command.open_palette")}
              className="hidden md:flex items-center gap-2 px-2.5 h-8 rounded-md border border-border/80 bg-background/40 min-w-[220px] max-w-[300px] hover:bg-accent transition-colors text-left"
            >
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-[12.5px] flex-1 min-w-0 truncate text-muted-foreground/80">
                {t("command.search_or_jump")}
              </span>
              <kbd className="font-mono text-[10px] text-muted-foreground/70 border border-border/70 rounded-sm px-1 py-px tracking-wider shrink-0">
                {isMac ? "⌘K" : "Ctrl K"}
              </kbd>
            </button>

            <Button
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              aria-label={t("command.open_palette")}
              onClick={() => openPalette(true)}
            >
              <Search className="h-3.5 w-3.5" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger
                className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border/80 bg-background/40 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={t("command.recently_viewed")}
                disabled={recent.length === 0}
              >
                <Clock className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t("command.recently_viewed")}
                </div>
                <DropdownMenuSeparator />
                {recent.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-muted-foreground">
                    {t("command.no_recent")}
                  </div>
                ) : (
                  <>
                    {recent.map((e) => (
                      <DropdownMenuItem
                        key={`${e.type}-${e.id}`}
                        onClick={() => navigate(entityPath(e))}
                        className="flex items-start gap-2"
                      >
                        <span className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/80 mt-1 shrink-0">
                          {t(`command.type_${e.type}`)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{e.label}</div>
                          {e.sublabel && (
                            <div className="text-[11px] text-muted-foreground truncate">
                              {e.sublabel}
                            </div>
                          )}
                        </div>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => clearRecentlyViewed()}>
                      <span className="text-xs text-muted-foreground">{t("common.clear")}</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <NotificationsDropdown />
          </div>
        </div>
      </div>
    </header>
  );
}
