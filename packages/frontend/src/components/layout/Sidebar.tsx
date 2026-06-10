import {
  BarChart3,
  ClipboardList,
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
import { type Theme, useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { getNavItems, useNavGate } from "@/nav-registry";
import { useAuthStore } from "@/stores/auth.store";

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
        { to: "/reports", icon: BarChart3, label: t("nav.reports") },
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
  // sections by their `section` i18n key (default "nav.extensions").
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
        const sectionKey = item.section ?? "nav.extensions";
        if (!acc[sectionKey]) acc[sectionKey] = { label: t(sectionKey), items: [] };
        acc[sectionKey].items.push({
          to: item.to,
          icon: item.icon,
          label: t(item.labelKey),
        });
        return acc;
      }, {}),
  );

  return (
    <aside
      className={cn(
        "flex flex-col rounded-lg border border-black/[0.10] dark:border-white/[0.08] bg-white/70 dark:bg-[oklch(0.10_0.025_265/0.65)] backdrop-blur-xl backdrop-saturate-[1.3] shadow-[0_6px_18px_-8px_rgb(0_0_0/0.10),inset_0_0_0_1px_rgb(0_0_0/0.04)] dark:shadow-[0_6px_18px_-8px_rgb(0_0_0/0.7),inset_0_0_0_1px_rgb(255_255_255/0.04)] h-full overflow-hidden transition-all duration-200",
        collapsed ? "w-16" : "w-56",
      )}
    >
      <div className="flex items-center px-4 h-14 border-b border-black/[0.10] dark:border-white/[0.08]">
        {collapsed ? <InkvoiceIcon className="w-8 h-8" /> : <InkvoiceLogo className="h-9" />}
      </div>
      <nav className="flex-1 py-4 px-2 space-y-5 overflow-y-auto">
        {[...navSections, ...extensionSections].map((section) => (
          <div key={section.label}>
            {!collapsed && (
              <p className="px-3 mb-2 font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition-colors relative",
                      isActive
                        ? "bg-primary/12 text-primary font-medium"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-primary" />
                      )}
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.label}</span>}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
        {user?.is_admin && (
          <div>
            {!collapsed && (
              <p className="px-3 mb-2 font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
                {t("nav.admin")}
              </p>
            )}
            <div className="space-y-0.5">
              {adminItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition-colors relative",
                      isActive
                        ? "bg-primary/12 text-primary font-medium"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-primary" />
                      )}
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.label}</span>}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Footer — user + theme toggle */}
      <div
        className={cn(
          "border-t border-black/[0.10] dark:border-white/[0.08] flex items-center gap-2",
          collapsed ? "p-2 flex-col" : "p-3",
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={user?.display_name || user?.username || ""}
            className={cn(
              "flex items-center gap-2.5 rounded-md hover:bg-accent transition-colors cursor-pointer outline-none",
              collapsed ? "p-1" : "flex-1 min-w-0 p-1 -m-1",
            )}
          >
            <div className="flex items-center justify-center h-7 w-7 rounded-full bg-gradient-to-br from-primary to-violet-500 text-white font-mono text-[11px] font-semibold shrink-0">
              {initial}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0 text-left leading-tight">
                <div className="text-[12px] font-medium truncate">
                  {user?.display_name || user?.username}
                </div>
                <div className="font-mono text-[9.5px] text-muted-foreground/80 tracking-[0.06em] truncate">
                  {/* Match the Users table: show the RBAC role when present. */}
                  {(user?.role || (user?.is_admin ? "Admin" : "User")).toUpperCase()}
                </div>
              </div>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top">
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              {t("header.logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={() => setTheme(nextTheme(theme))}
          aria-label={t("header.color_scheme", { theme: themeMeta[theme].label })}
          className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-border/70 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
        >
          <ThemeIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      {!collapsed && (
        <div className="px-3.5 pb-2.5 -mt-1 font-mono text-[9.5px] text-muted-foreground/45 tracking-[0.06em]">
          v{APP_VERSION}
        </div>
      )}
    </aside>
  );
}
