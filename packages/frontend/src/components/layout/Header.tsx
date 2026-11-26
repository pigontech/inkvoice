import { Clock, PanelLeft, Search } from "lucide-react";
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
        <div className="flex items-center justify-center gap-2 h-7 border-b border-border bg-warning-soft text-warning text-xs font-medium">
          {t("common.demo_mode")} — {t("common.demo_mode_notice")}
        </div>
      )}
      <div className="border-b border-border bg-card">
        <div className="flex items-center gap-2 h-[52px] pl-3 pr-4 md:pr-6">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleSidebar}
            aria-label={t("header.toggle_sidebar")}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <div className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <span>Inkvoice</span>
            <span aria-hidden="true">/</span>
            <span className="truncate font-semibold text-foreground">{crumb}</span>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => openPalette(true)}
              aria-label={t("command.open_palette")}
              className="hidden md:flex items-center gap-2 pl-2 pr-1.5 h-8 w-[280px] rounded-md border border-border-strong bg-card hover:bg-muted transition-colors text-left"
            >
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm flex-1 min-w-0 truncate text-muted-foreground">
                {t("command.search_or_jump")}
              </span>
              <kbd className="font-sans text-[11px] leading-4 text-muted-foreground border border-border bg-muted rounded-[3px] px-1 shrink-0">
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
                className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border-strong bg-card text-secondary-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={t("command.recently_viewed")}
                disabled={recent.length === 0}
              >
                <Clock className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
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
                        <span className="text-[11px] text-muted-foreground mt-0.5 shrink-0 capitalize">
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
