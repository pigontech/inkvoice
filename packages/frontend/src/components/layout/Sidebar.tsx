import {
  BarChart3,
  ChevronsUpDown,
  ClipboardList,
  FileCheck2,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  Package,
  Receipt,
  Repeat,
  Settings,
  Sun,
  UserCog,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { InkvoiceIcon, InkvoiceLogo } from "@/components/InkvoiceLogo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCan } from "@/hooks/use-can";
import { type Theme, useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { getNavItems, useNavGate } from "@/nav-registry";
import { useAuthStore } from "@/stores/auth.store";
import { useSettingsStore } from "@/stores/settings.store";

const themeCycle: Theme[] = ["light", "dark", "auto"];
function nextTheme(current: Theme): Theme {
  const i = themeCycle.indexOf(current);
  return themeCycle[(i + 1) % themeCycle.length];
}

export function Sidebar({ collapsed }: { collapsed?: boolean }) {
  const { user, logout } = useAuthStore();
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const einvoiceEnabled = useSettingsStore((s) => s.settings.einvoice_enabled === "true");

  const themeMeta: Record<Theme, { label: string; icon: typeof Sun }> = {
    light: { label: t("header.theme_light"), icon: Sun },
    dark: { label: t("header.theme_dark"), icon: Moon },
    auto: { label: t("header.theme_auto"), icon: Monitor },
  };
  const ThemeIcon = themeMeta[theme].icon;

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const initial = (user?.display_name || user?.username || "?").charAt(0).toUpperCase();

  // Every report is built from invoices, expenses or both.
  const can = useCan();
  const canSeeReports = can("invoices", "read") || can("expenses", "read");

  const navSections = [
    {
      label: t("nav.main"),
      items: [
        { to: "/", icon: LayoutDashboard, label: t("nav.dashboard") },
        { to: "/invoices", icon: FileText, label: t("nav.invoices") },
        { to: "/quotes", icon: ClipboardList, label: t("nav.quotes") },
        { to: "/recurring", icon: Repeat, label: t("nav.recurring") },
      ],
    },
    {
      label: t("nav.catalog"),
      items: [
        { to: "/customers", icon: Users, label: t("nav.customers") },
        { to: "/products", icon: Package, label: t("nav.products") },
        { to: "/expenses", icon: Receipt, label: t("nav.expenses") },
        ...(einvoiceEnabled
          ? [{ to: "/einvoices", icon: FileCheck2, label: t("nav.einvoices") }]
          : []),
        ...(canSeeReports ? [{ to: "/reports", icon: BarChart3, label: t("nav.reports") }] : []),
      ],
    },
  ];

  const adminItems = [
    { to: "/settings", icon: Settings, label: t("nav.settings") },
    { to: "/users", icon: UserCog, label: t("nav.users") },
    { to: "/activity", icon: History, label: t("nav.activity") },
  ];

  // Plugin/extension nav items registered via the nav registry. Admin-only and
  // disabled-plugin entries are filtered out, then grouped into sidebar
  // sections by their `section` i18n key (default "nav.plugins").
  type SidebarSection = {
    label: string;
    items: { to: string; icon: ComponentType<{ className?: string }>; label: string }[];
  };
  const navGate = useNavGate();
  const extensionSections: SidebarSection[] = Object.values(
    getNavItems()
      .filter((item) => {
        if (item.adminOnly && !user?.is_admin) return false;
        if (item.pluginId && !navGate(item.pluginId)) return false;
        return true;
      })
      .reduce<Record<string, SidebarSection>>((acc, item) => {
        const sectionKey = item.section ?? "nav.plugins";
        if (!acc[sectionKey]) acc[sectionKey] = { label: t(sectionKey), items: [] };
        acc[sectionKey].items.push({
          to: item.to,
          icon: item.icon,
          label: t(item.labelKey),
        });
        return acc;
      }, {}),
  );

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex h-[30px] items-center gap-2 rounded-md text-[13px] transition-colors",
      collapsed ? "justify-center px-0" : "px-2",
      isActive
        ? "bg-brand font-semibold text-brand-foreground"
        : "font-medium text-secondary-foreground hover:bg-accent hover:text-foreground",
    );
  const sections: SidebarSection[] = [
    ...navSections,
    ...extensionSections,
    ...(user?.is_admin ? [{ label: t("nav.admin"), items: adminItems }] : []),
  ];

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar transition-all duration-200",
        collapsed ? "w-14" : "w-[216px]",
      )}
    >
      <div
        className={cn(
          "flex h-[52px] shrink-0 items-center border-b border-sidebar-border",
          collapsed ? "justify-center" : "px-2",
        )}
      >
        {collapsed ? <InkvoiceIcon className="w-8 h-8" /> : <InkvoiceLogo className="h-9" />}
      </div>
      <nav className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-2 pt-3 pb-4">
        {sections.map((section) => (
          <div key={section.label} className="flex flex-col gap-px">
            {!collapsed && (
              <p className="px-2 pb-1 text-[11px] leading-4 font-medium text-muted-foreground">
                {section.label}
              </p>
            )}
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                title={collapsed ? item.label : undefined}
                className={linkClass}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer: account, color scheme, version */}
      <div className="flex shrink-0 flex-col gap-2 border-t border-sidebar-border p-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={user?.display_name || user?.username || ""}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md p-1 text-left outline-none transition-colors hover:bg-accent",
              collapsed && "justify-center",
            )}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-xs font-semibold text-background">
              {initial}
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] leading-4 font-semibold">
                    {user?.display_name || user?.username}
                  </div>
                  <div className="truncate text-[11px] leading-[14px] text-muted-foreground">
                    {/* Match the Users table: show the RBAC role when present. */}
                    {user?.role || (user?.is_admin ? "Admin" : "User")}
                  </div>
                </div>
                <ChevronsUpDown className="mr-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top">
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              {t("header.logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {collapsed && (
          <button
            type="button"
            onClick={() => setTheme(nextTheme(theme))}
            aria-label={t("header.color_scheme", { theme: themeMeta[theme].label })}
            className="mx-auto inline-flex h-7 w-7 items-center justify-center rounded-md border border-border-strong text-secondary-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ThemeIcon className="h-3.5 w-3.5" />
          </button>
        )}
        {!collapsed && (
          <div className="flex items-center justify-between gap-2 px-1 pb-0.5">
            <div className="inline-flex overflow-hidden rounded-md border border-border-strong">
              {themeCycle.map((value, i) => {
                const Icon = themeMeta[value].icon;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTheme(value)}
                    aria-label={themeMeta[value].label}
                    aria-pressed={theme === value}
                    className={cn(
                      "inline-flex h-[22px] w-7 items-center justify-center transition-colors",
                      i > 0 && "border-l border-border-strong",
                      theme === value
                        ? "bg-foreground text-background"
                        : "text-secondary-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Icon className="h-[13px] w-[13px]" />
                  </button>
                );
              })}
            </div>
            <span className="text-[11px] leading-[14px] whitespace-nowrap text-muted-foreground">
              v{APP_VERSION}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
