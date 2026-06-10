import {
  BarChart3,
  ClipboardList,
  Clock,
  FileText,
  History,
  LayoutDashboard,
  Package,
  Plus,
  Repeat,
  Settings,
  UserCog,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { create } from "zustand";
import { api } from "@/api/client";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useTranslation } from "@/i18n";
import {
  getRecentlyViewed,
  type RecentEntity,
  subscribeRecentlyViewed,
} from "@/lib/recently-viewed";
import { useAuthStore } from "@/stores/auth.store";

interface CommandPaletteState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useCommandPalette = create<CommandPaletteState>((set, get) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set({ open: !get().open }),
}));

interface SearchResults {
  invoices: { id: string; invoice_number: string; customer_name: string | null }[];
  customers: { id: string; name: string; email: string | null }[];
  products: { id: string; name: string; sku: string | null }[];
}

const EMPTY_RESULTS: SearchResults = { invoices: [], customers: [], products: [] };

export function CommandPalette() {
  const open = useCommandPalette((s) => s.open);
  const setOpen = useCommandPalette((s) => s.setOpen);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAdmin = useAuthStore((s) => s.user?.is_admin ?? false);

  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [recent, setRecent] = useState<RecentEntity[]>([]);
  const fetchSeq = useRef(0);

  // Listen for ⌘K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useCommandPalette.getState().toggle();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setSearch("");
      setResults(EMPTY_RESULTS);
    } else {
      setRecent(getRecentlyViewed());
    }
  }, [open]);

  // Subscribe to recently viewed updates
  useEffect(() => {
    return subscribeRecentlyViewed(() => setRecent(getRecentlyViewed()));
  }, []);

  // Debounced server-side search
  useEffect(() => {
    if (!open) return;
    const trimmed = search.trim();
    if (trimmed.length < 2) {
      setResults(EMPTY_RESULTS);
      return;
    }
    const seq = ++fetchSeq.current;
    const timer = setTimeout(async () => {
      try {
        const [inv, cust, prod] = await Promise.all([
          api.listInvoices({ search: trimmed, limit: "5" }).catch(() => null),
          api.listCustomers({ search: trimmed, limit: "5" }).catch(() => null),
          api.listProducts({ search: trimmed, limit: "5" }).catch(() => null),
        ]);
        if (seq !== fetchSeq.current) return;
        setResults({
          invoices: inv?.data?.items ?? [],
          customers: cust?.data?.items ?? [],
          products: prod?.data?.items ?? [],
        });
      } catch {
        if (seq === fetchSeq.current) setResults(EMPTY_RESULTS);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [search, open]);

  const go = useCallback(
    (path: string) => {
      setOpen(false);
      navigate(path);
    },
    [navigate, setOpen],
  );

  const navItems = useMemo(
    () => [
      { icon: LayoutDashboard, label: t("nav.dashboard"), to: "/" },
      { icon: FileText, label: t("nav.invoices"), to: "/invoices" },
      { icon: ClipboardList, label: t("nav.quotes"), to: "/quotes" },
      { icon: Repeat, label: t("nav.recurring"), to: "/recurring" },
      { icon: Users, label: t("nav.customers"), to: "/customers" },
      { icon: Package, label: t("nav.products"), to: "/products" },
      { icon: BarChart3, label: t("nav.reports"), to: "/reports" },
      ...(isAdmin
        ? [
            { icon: Settings, label: t("nav.settings"), to: "/settings" },
            { icon: UserCog, label: t("nav.users"), to: "/users" },
            { icon: History, label: t("nav.activity"), to: "/activity" },
          ]
        : []),
    ],
    [t, isAdmin],
  );

  const createItems = useMemo(
    () => [
      { icon: FileText, label: t("invoices.new_invoice"), to: "/invoices/new" },
      { icon: ClipboardList, label: t("quotes.new_quote"), to: "/quotes/new" },
      { icon: Users, label: t("customers.add_customer"), to: "/customers/new" },
      { icon: Package, label: t("products.add_product"), to: "/products/new" },
    ],
    [t],
  );

  const recentToPath = (entry: RecentEntity): string => {
    switch (entry.type) {
      case "invoice":
        return `/invoices/${entry.id}`;
      case "quote":
        return `/quotes/${entry.id}`;
      case "customer":
        return `/customers/${entry.id}`;
      case "product":
        return `/products/${entry.id}`;
    }
  };

  const recentIcon = (type: RecentEntity["type"]) => {
    switch (type) {
      case "invoice":
        return FileText;
      case "quote":
        return ClipboardList;
      case "customer":
        return Users;
      case "product":
        return Package;
    }
  };

  const showResults = search.trim().length >= 2;
  const showRecents = !showResults && recent.length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t("command.title")}
      description={t("command.description")}
      className="sm:max-w-[600px]"
    >
      <Command shouldFilter={search.trim().length < 2}>
        <CommandInput
          placeholder={t("command.placeholder")}
          value={search}
          onValueChange={setSearch}
          autoFocus
        />
        <CommandList>
          <CommandEmpty>{t("command.no_results")}</CommandEmpty>

          {showResults && results.invoices.length > 0 && (
            <CommandGroup heading={t("nav.invoices")}>
              {results.invoices.map((inv) => (
                <CommandItem
                  key={`inv-${inv.id}`}
                  value={`invoice ${inv.invoice_number} ${inv.customer_name ?? ""}`}
                  onSelect={() => go(`/invoices/${inv.id}`)}
                >
                  <FileText />
                  <span className="font-medium tabular-nums">{inv.invoice_number}</span>
                  {inv.customer_name && (
                    <span className="text-muted-foreground text-xs ml-2 truncate">
                      {inv.customer_name}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {showResults && results.customers.length > 0 && (
            <CommandGroup heading={t("nav.customers")}>
              {results.customers.map((c) => (
                <CommandItem
                  key={`cust-${c.id}`}
                  value={`customer ${c.name} ${c.email ?? ""}`}
                  onSelect={() => go(`/customers/${c.id}`)}
                >
                  <Users />
                  <span>{c.name}</span>
                  {c.email && (
                    <span className="text-muted-foreground text-xs ml-2 truncate">{c.email}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {showResults && results.products.length > 0 && (
            <CommandGroup heading={t("nav.products")}>
              {results.products.map((p) => (
                <CommandItem
                  key={`prod-${p.id}`}
                  value={`product ${p.name} ${p.sku ?? ""}`}
                  onSelect={() => go(`/products/${p.id}`)}
                >
                  <Package />
                  <span>{p.name}</span>
                  {p.sku && <span className="text-muted-foreground text-xs ml-2">{p.sku}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {showResults && <CommandSeparator />}

          {showRecents && (
            <>
              <CommandGroup heading={t("command.recently_viewed")}>
                {recent.map((entry) => {
                  const Icon = recentIcon(entry.type);
                  return (
                    <CommandItem
                      key={`${entry.type}-${entry.id}`}
                      value={`recent ${entry.label} ${entry.sublabel ?? ""}`}
                      onSelect={() => go(recentToPath(entry))}
                    >
                      <Icon />
                      <span>{entry.label}</span>
                      {entry.sublabel && (
                        <span className="text-muted-foreground text-xs ml-2 truncate">
                          {entry.sublabel}
                        </span>
                      )}
                      <Clock className="ml-auto h-3 w-3 text-muted-foreground/70" />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          <CommandGroup heading={t("command.create_new")}>
            {createItems.map((item) => (
              <CommandItem
                key={item.to}
                value={`create ${item.label}`}
                onSelect={() => go(item.to)}
              >
                <Plus />
                <span>{item.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading={t("command.navigate")}>
            {navItems.map((item) => (
              <CommandItem key={item.to} value={`go ${item.label}`} onSelect={() => go(item.to)}>
                <item.icon />
                <span>{item.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
