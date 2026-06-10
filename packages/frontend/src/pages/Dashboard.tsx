import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ChevronRight,
  Clock,
  DollarSign,
  FileText,
  Plus,
  Users,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";
import { formatCurrency } from "@/lib/utils";

const STATUS_MAP: Record<string, { dot: string; label?: string }> = {
  draft: { dot: "bg-slate-400" },
  sent: { dot: "bg-blue-400" },
  paid: { dot: "bg-emerald-400" },
  overdue: { dot: "bg-red-400" },
  voided: { dot: "bg-gray-400" },
};

function AetherTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md bg-popover/95 backdrop-blur-md border border-border px-3 py-2 shadow-[0_6px_18px_-8px_rgb(0_0_0/0.7)]">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground mb-1">
        {label}
      </p>
      <div className="space-y-0.5">
        {payload.map((entry: any) => (
          <div key={entry.dataKey} className="flex items-center gap-2">
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ background: entry.color }}
            />
            <span className="font-mono text-sm font-semibold tabular-nums">
              {formatCurrency(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data.length) return null;
  const w = 64;
  const h = 22;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = Math.max(1, max - min);
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * (w - 2) + 1;
      const y = h - 1 - ((v - min) / range) * (h - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = data[data.length - 1];
  const lastY = h - 1 - ((last - min) / range) * (h - 2);
  return (
    <svg width={w} height={h} className="block" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
      <circle cx={w - 1} cy={lastY} r={2} fill={color} />
    </svg>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<any>(null);
  const [chart, setChart] = useState<any[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [topCustomers, setTopCustomers] = useState<any[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [compareYoy, setCompareYoy] = useState(false);
  const navigate = useNavigate();

  const statCards = [
    {
      key: "total_revenue",
      label: t("dashboard.revenue"),
      to: "/reports/revenue-customer",
      icon: DollarSign,
      color: "var(--chart-2)",
      isCurrency: true,
    },
    {
      key: "total_outstanding",
      label: t("dashboard.outstanding"),
      to: "/reports/aging",
      icon: Clock,
      color: "var(--chart-4)",
      isCurrency: true,
    },
    {
      key: "net_income",
      label: t("dashboard.net_income"),
      to: "/reports/profit-loss",
      icon: Wallet,
      color: "var(--chart-5)",
      isCurrency: true,
    },
    {
      key: "total_invoices",
      label: t("dashboard.invoices"),
      to: "/invoices",
      icon: FileText,
      color: "var(--chart-1)",
      isCurrency: false,
    },
    {
      key: "total_customers",
      label: t("dashboard.clients"),
      to: "/customers",
      icon: Users,
      color: "var(--chart-3)",
      isCurrency: false,
    },
  ];

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [s, ch, r, top] = await Promise.all([
        api.getDashboardStats(),
        api.getRevenueChart(compareYoy),
        api.getRecentInvoices(),
        api.getTopCustomers(5),
      ]);
      setStats(s.data);
      setChart(ch.data);
      setRecent(r.data);
      setTopCustomers(top.data);
    } catch (e) {
      setLoadError(formatApiError(e, t));
    } finally {
      setLoading(false);
    }
  }, [t, compareYoy]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 min-h-[50vh] px-4">
        <p className="text-muted-foreground text-center max-w-md">{loadError}</p>
        <Button type="button" onClick={() => loadDashboard()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6" role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">{t("common.loading")}</span>
        {/* Header */}
        <div className="flex items-end justify-between">
          <div className="space-y-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Card key={i} className="py-0">
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-1.5 w-1.5 rounded-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <div className="flex items-end justify-between">
                  <Skeleton className="h-8 w-28" />
                  <Skeleton className="h-10 w-10 rounded-xl" />
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Chart + recent */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2 p-6">
            <div className="space-y-2 mb-6">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-44" />
            </div>
            <Skeleton className="h-[300px] w-full" />
          </Card>
          <Card className="lg:col-span-1 p-5 space-y-3">
            <Skeleton className="h-4 w-32" />
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="h-2 w-2 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-2.5 w-32" />
                </div>
                <Skeleton className="h-3.5 w-16" />
              </div>
            ))}
          </Card>
        </div>

        {/* Clients */}
        <Card className="p-5 space-y-3">
          <Skeleton className="h-4 w-32" />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3 p-3.5">
                <Skeleton className="h-9 w-9 rounded-xl" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("dashboard.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => navigate("/reports")}>
            <ArrowUpRight />
            <span>{t("common.view_all")}</span>
          </Button>
          <Button type="button" size="sm" onClick={() => navigate("/invoices/new")}>
            <Plus />
            <span>{t("invoices.new_invoice")}</span>
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {statCards.map((sc) => {
          const value = sc.isCurrency
            ? formatCurrency(stats?.[sc.key] ?? 0, stats?.base_currency)
            : (stats?.[sc.key] ?? 0);
          const trend: number[] = stats?.trends?.[sc.key] ?? [];
          const delta: number | null = stats?.deltas?.[sc.key] ?? null;
          const positive = (delta ?? 0) >= 0;
          // For "outstanding" a decrease is good — invert the color cue.
          const isGoodWhenDown = sc.key === "total_outstanding";
          const goodNews = isGoodWhenDown ? !positive : positive;
          return (
            <Card
              key={sc.key}
              role="button"
              tabIndex={0}
              className="group cursor-pointer py-0 transition-all duration-200 hover:-translate-y-0.5 hover:border-black/[0.16] dark:hover:border-white/[0.14]"
              onClick={() => navigate(sc.to)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate(sc.to);
                }
              }}
            >
              <div className="relative p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80 truncate">
                      {sc.label}
                    </span>
                  </div>
                  <Sparkline data={trend} color={sc.color} />
                </div>
                <div className="flex items-end justify-between gap-3">
                  <div className="font-mono text-[26px] font-semibold tabular-nums tracking-tight leading-none">
                    {value}
                  </div>
                  <div
                    className="flex items-center justify-center h-7 w-7 rounded-md border border-border/80 bg-background/40"
                    style={{ color: sc.color }}
                  >
                    <sc.icon className="h-3.5 w-3.5" />
                  </div>
                </div>
                {delta !== null ? (
                  <div
                    className={`mt-3 flex items-center gap-1 font-mono text-[11px] tabular-nums ${
                      goodNews
                        ? "text-emerald-500 dark:text-emerald-400"
                        : "text-red-500 dark:text-red-400"
                    }`}
                  >
                    {positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                    <span>{Math.abs(delta).toFixed(1)}%</span>
                    <span className="text-muted-foreground/70 ml-1">
                      {t("dashboard.vs_last_month")}
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 h-[15px]" aria-hidden />
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Main grid: Chart + Recent Invoices */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Revenue Chart */}
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="aether-eyebrow mb-1.5">Revenue · 12M</p>
              <h2 className="font-mono text-base font-semibold tracking-tight">
                {t("dashboard.monthly_revenue")}
              </h2>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                {t("dashboard.last_12_months")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCompareYoy((v) => !v)}
              aria-pressed={compareYoy}
              className={`font-mono text-[11px] border rounded-md px-2.5 py-1 transition-colors ${
                compareYoy
                  ? "border-primary/60 text-primary bg-primary/5"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("dashboard.compare_yoy")}
            </button>
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                key={compareYoy ? "yoy" : "single"}
                data={chart}
                margin={{ top: 8, right: 4, bottom: 0, left: -10 }}
                barCategoryGap="22%"
              >
                <defs>
                  <linearGradient id="aetherBarGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={1} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.45} />
                  </linearGradient>
                  <linearGradient id="aetherBarGradPrev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.85} />
                    <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.35} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="2 4"
                  stroke="currentColor"
                  className="text-border"
                  vertical={false}
                />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10, fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}
                  className="text-muted-foreground"
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                  className="text-muted-foreground"
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  content={<AetherTooltip />}
                  cursor={{ fill: "var(--accent)", opacity: 0.4 }}
                />
                {compareYoy && (
                  <Bar
                    dataKey="previous_revenue"
                    fill="url(#aetherBarGradPrev)"
                    radius={[2, 2, 0, 0]}
                    maxBarSize={48}
                  />
                )}
                <Bar
                  dataKey="revenue"
                  fill="url(#aetherBarGrad)"
                  radius={[2, 2, 0, 0]}
                  maxBarSize={48}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Recent Invoices */}
        <Card className="lg:col-span-1 flex flex-col py-0">
          <div className="px-4 pt-4 pb-3 flex items-center justify-between border-b border-border/60">
            <div>
              <p className="aether-eyebrow mb-1">Latest</p>
              <h2 className="font-mono text-sm font-semibold tracking-tight">
                {t("dashboard.recent_invoices")}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => navigate("/invoices")}
              className="font-mono text-[10.5px] text-primary hover:text-primary/80 transition-colors flex items-center gap-0.5 uppercase tracking-[0.14em] font-medium"
            >
              {t("common.all")} <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          <div className="flex-1 overflow-auto">
            {recent.length === 0 && (
              <p className="text-sm text-muted-foreground py-10 text-center">
                {t("dashboard.no_invoices_yet")}
              </p>
            )}
            <div>
              {recent.map((inv: any, i: number) => (
                <button
                  key={inv.id}
                  type="button"
                  className={`w-full text-left flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/60 transition-colors group ${
                    i > 0 ? "border-t border-border/60" : ""
                  }`}
                  onClick={() => navigate(`/invoices/${inv.id}`)}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_MAP[inv.status]?.dot ?? "bg-gray-400"}`}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-[12.5px] font-medium tabular-nums">
                      {inv.invoice_number}
                    </span>
                    <div className="text-[12px] text-muted-foreground truncate mt-0.5">
                      {inv.customer_name}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-[13px] font-semibold tabular-nums">
                      {formatCurrency(inv.total, inv.currency)}
                    </div>
                    <div className="font-mono text-[9.5px] text-muted-foreground uppercase tracking-[0.14em] mt-0.5">
                      {t("invoices.status_" + inv.status)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Top Customers by Revenue */}
      <Card className="py-0">
        <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-border/60">
          <div>
            <p className="aether-eyebrow mb-1">{t("dashboard.top_customers_eyebrow")}</p>
            <h2 className="font-mono text-sm font-semibold tracking-tight">
              {t("dashboard.top_customers")}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => navigate("/customers")}
            className="font-mono text-[10.5px] text-primary hover:text-primary/80 transition-colors flex items-center gap-0.5 uppercase tracking-[0.14em] font-medium"
          >
            {t("common.view_all")} <ChevronRight className="h-3 w-3" />
          </button>
        </div>
        <div className="p-4">
          {topCustomers.length === 0 && (
            <p className="text-sm text-muted-foreground py-10 text-center">
              {t("dashboard.no_revenue_yet")}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {topCustomers.map((c: any) => (
              <button
                key={c.id}
                type="button"
                className="text-left flex items-center gap-3 p-3 rounded-md cursor-pointer bg-background/30 hover:bg-accent/60 border border-border/70 hover:border-border transition-colors"
                onClick={() =>
                  navigate(
                    `/invoices/all?customer_id=${encodeURIComponent(c.id)}&customer_name=${encodeURIComponent(c.name)}`,
                  )
                }
              >
                <div className="flex items-center justify-center h-9 w-9 rounded-md bg-gradient-to-br from-primary/80 to-violet-500 text-xs font-semibold text-white font-mono shrink-0 shadow-[0_4px_14px_-6px_var(--primary)]">
                  {c.name?.charAt(0)?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate">{c.name}</div>
                  <div className="font-mono text-[10.5px] text-muted-foreground truncate tabular-nums">
                    {formatCurrency(c.total_revenue, stats?.base_currency)}
                  </div>
                </div>
                {(c.invoice_count ?? 0) > 0 && (
                  <div className="font-mono text-[10px] text-muted-foreground tabular-nums shrink-0 px-1.5 py-0.5 rounded-sm border border-border/70">
                    {c.invoice_count}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
