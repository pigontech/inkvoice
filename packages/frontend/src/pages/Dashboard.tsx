import { ArrowDown, ArrowUp, ArrowUpRight, ChevronRight, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/api/client";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCan } from "@/hooks/use-can";
import { useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";
import { cn, formatCurrency, formatDate, getCurrentLocale } from "@/lib/utils";

/** "2026-11" becomes a short month name in the app language. */
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString(getCurrentLocale(), { month: "short" });
}

function ChartTooltip({ active, payload, label, currency, names }: any) {
  if (!active || !payload?.length) return null;
  const [y] = String(label).split("-");
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-2 text-xs shadow-md">
      <p className="mb-1 text-muted-foreground">
        {monthLabel(label)} {y}
      </p>
      <div className="space-y-0.5">
        {[...payload].reverse().map((entry: any) => (
          <div key={entry.dataKey} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ background: entry.payload?.[`${entry.dataKey}_fill`] ?? entry.color }}
            />
            {payload.length > 1 && (
              <span className="text-muted-foreground">{names[entry.dataKey]}</span>
            )}
            <span className="ml-auto font-semibold tabular-nums">
              {formatCurrency(entry.value, currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 64;
  const h = 18;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = Math.max(1, max - min);
  const y = (v: number) => h - 2 - ((v - min) / range) * (h - 4);
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * (w - 4) + 1).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="block shrink-0" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--border-strong)" strokeWidth={1.25} />
      <circle cx={w - 3} cy={y(data[data.length - 1])} r={1.75} fill="var(--foreground)" />
    </svg>
  );
}

function PanelHeader({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border px-3.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <h2 className="text-sm font-semibold whitespace-nowrap">{title}</h2>
        {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

const panelLink =
  "inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-secondary-foreground transition-colors hover:text-foreground";

export default function Dashboard() {
  const { t } = useTranslation();
  const canCreateInvoice = useCan()("invoices", "create");
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
      isCurrency: true,
    },
    {
      key: "total_outstanding",
      label: t("dashboard.outstanding"),
      to: "/reports/aging",
      isCurrency: true,
    },
    {
      key: "net_income",
      label: t("dashboard.net_income"),
      to: "/reports/profit-loss",
      isCurrency: true,
    },
    {
      key: "total_invoices",
      label: t("dashboard.invoices"),
      to: "/invoices",
      isCurrency: false,
    },
    {
      key: "total_customers",
      label: t("dashboard.clients"),
      to: "/customers",
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
      <div
        className="mx-auto flex w-full max-w-[1320px] flex-col gap-4"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="sr-only">{t("common.loading")}</span>
        <div className="flex h-8 items-center gap-3">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-52" />
        </div>
        <Card className="flex-row flex-wrap gap-0 py-0">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="min-w-[170px] flex-1 space-y-2 px-4 pt-3 pb-3.5">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </Card>
        <div className="flex flex-wrap gap-4">
          <Card className="min-w-[min(100%,520px)] flex-[3_1_0] gap-3 p-3.5">
            <Skeleton className="h-4 w-32" />
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </Card>
          <Card className="min-w-[min(100%,340px)] flex-[2_1_0] gap-3 p-3.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-[212px] w-full" />
          </Card>
        </div>
        <Card className="gap-3 p-3.5">
          <Skeleton className="h-4 w-32" />
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </Card>
      </div>
    );
  }

  const baseCurrency = stats?.base_currency;
  const lastIndex = chart.length - 1;
  const chartData = chart.map((row: any, i: number) => ({
    ...row,
    revenue_fill: i === lastIndex ? "var(--chart-now)" : "var(--chart-bar)",
    previous_revenue_fill: "var(--chart-bar-2)",
  }));
  const seriesNames = {
    revenue: t("dashboard.this_year"),
    previous_revenue: t("dashboard.previous_year"),
  };
  const topRevenue = Math.max(0, ...topCustomers.map((c: any) => c.total_revenue ?? 0));
  const revenueBase =
    stats?.total_revenue > 0
      ? stats.total_revenue
      : topCustomers.reduce((sum: number, c: any) => sum + (c.total_revenue ?? 0), 0);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[22px] leading-[30px] font-semibold tracking-[-0.01em]">
            {t("dashboard.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("dashboard.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => navigate("/reports")}>
            <span>{t("nav.reports")}</span>
            <ArrowUpRight />
          </Button>
          {canCreateInvoice && (
            <Button type="button" onClick={() => navigate("/invoices/new")}>
              <Plus />
              <span>{t("invoices.new_invoice")}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Stat strip */}
      <div className="flex flex-wrap gap-px overflow-hidden rounded-lg border border-border bg-border">
        {statCards
          // The server sends null for a figure this user may not see.
          .filter((sc) => stats?.[sc.key] !== null)
          .map((sc) => {
            const value = sc.isCurrency
              ? formatCurrency(stats?.[sc.key] ?? 0, baseCurrency)
              : (stats?.[sc.key] ?? 0);
            const trend: number[] = stats?.trends?.[sc.key] ?? [];
            const delta: number | null = stats?.deltas?.[sc.key] ?? null;
            const positive = (delta ?? 0) >= 0;
            // For "outstanding" a decrease is good, so the color cue is inverted.
            const isGoodWhenDown = sc.key === "total_outstanding";
            const goodNews = isGoodWhenDown ? !positive : positive;
            const expenses: number | null =
              sc.key === "net_income" ? (stats?.total_expenses ?? null) : null;
            return (
              <button
                key={sc.key}
                type="button"
                className="flex min-w-[min(100%,170px)] flex-[1_1_0] cursor-pointer flex-col gap-0.5 bg-card px-4 pt-3 pb-3.5 text-left transition-colors hover:bg-muted focus-visible:relative focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => navigate(sc.to)}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs leading-[18px] font-medium text-secondary-foreground">
                    {sc.label}
                  </span>
                  {sc.isCurrency && <Sparkline data={trend} />}
                </span>
                <span className="text-2xl leading-[30px] font-semibold tracking-[-0.015em] tabular-nums">
                  {value}
                </span>
                {delta !== null ? (
                  <span className="flex items-center gap-1.5 text-xs leading-4">
                    <span
                      className={cn(
                        "inline-flex items-center gap-px font-semibold tabular-nums",
                        goodNews ? "text-success" : "text-destructive",
                      )}
                    >
                      {positive ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      )}
                      {Math.abs(delta).toFixed(1)}%
                    </span>
                    <span className="whitespace-nowrap text-muted-foreground">
                      {t("dashboard.vs_last_month")}
                    </span>
                  </span>
                ) : expenses !== null && expenses > 0 ? (
                  <span className="truncate text-xs leading-4 text-muted-foreground">
                    {t("dashboard.after_expenses", {
                      amount: formatCurrency(expenses, baseCurrency),
                    })}
                  </span>
                ) : (
                  <span className="h-4" aria-hidden="true" />
                )}
              </button>
            );
          })}
      </div>

      {/* Recent invoices + revenue chart */}
      <div className="flex flex-wrap gap-4">
        <Card className="min-w-[min(100%,520px)] flex-[3_1_0] gap-0 py-0">
          <PanelHeader title={t("dashboard.recent_invoices")}>
            <button type="button" onClick={() => navigate("/invoices")} className={panelLink}>
              {t("common.view_all")} <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </PanelHeader>
          {recent.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t("dashboard.no_invoices_yet")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("invoices.invoice_number")}</TableHead>
                  <TableHead>{t("invoices.customer")}</TableHead>
                  <TableHead>{t("invoices.issue_date")}</TableHead>
                  <TableHead>{t("invoices.due_date")}</TableHead>
                  <TableHead>{t("invoices.status")}</TableHead>
                  <TableHead className="text-right">{t("common.total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((inv: any) => {
                  const late =
                    inv.status === "overdue" ||
                    (!!inv.due_date &&
                      inv.due_date < today &&
                      (inv.status === "sent" || inv.status === "partially_paid"));
                  return (
                    <TableRow
                      key={inv.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/invoices/${inv.id}`)}
                    >
                      <TableCell className="font-semibold">{inv.invoice_number}</TableCell>
                      <TableCell className="max-w-[220px] truncate">{inv.customer_name}</TableCell>
                      <TableCell className="text-secondary-foreground">
                        {inv.issue_date ? formatDate(inv.issue_date) : "-"}
                      </TableCell>
                      <TableCell
                        className={
                          late ? "font-medium text-destructive" : "text-secondary-foreground"
                        }
                      >
                        {inv.due_date ? formatDate(inv.due_date) : "-"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={inv.status}>
                          {t(`invoices.status_${inv.status}`)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(inv.total, inv.currency)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>

        <Card className="min-w-[min(100%,340px)] flex-[2_1_0] gap-0 py-0">
          <PanelHeader title={t("dashboard.monthly_revenue")} hint={t("dashboard.last_12_months")}>
            <div className="flex shrink-0 items-center gap-2 text-xs font-medium text-secondary-foreground">
              <span id="dashboard-yoy-label">{t("dashboard.compare_yoy")}</span>
              <Switch
                checked={compareYoy}
                onCheckedChange={setCompareYoy}
                aria-labelledby="dashboard-yoy-label"
              />
            </div>
          </PanelHeader>
          <div className="flex min-h-[236px] flex-1 flex-col px-3.5 pt-3 pb-2">
            {compareYoy && (
              <div className="mb-1 flex items-center gap-3 text-xs text-secondary-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-[2px] bg-chart-bar" />
                  {seriesNames.revenue}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-[2px] bg-chart-bar-2" />
                  {seriesNames.previous_revenue}
                </span>
              </div>
            )}
            <div className="min-h-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  key={compareYoy ? "yoy" : "single"}
                  data={chartData}
                  margin={{ top: 18, right: 2, bottom: 0, left: 0 }}
                  barGap={2}
                >
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis
                    dataKey="month"
                    interval={0}
                    height={24}
                    axisLine={{ stroke: "var(--chart-axis)" }}
                    tickLine={false}
                    tick={({ x, y, payload, index }: any) => (
                      <text
                        x={x}
                        y={y + 12}
                        textAnchor="middle"
                        fontSize={11}
                        fontWeight={index === lastIndex ? 600 : 400}
                        fill={index === lastIndex ? "var(--foreground)" : "var(--muted-foreground)"}
                      >
                        {monthLabel(payload.value)}
                      </text>
                    )}
                  />
                  <YAxis
                    width={44}
                    tickCount={5}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickFormatter={(v: number) => v.toLocaleString(getCurrentLocale())}
                  />
                  <Tooltip
                    content={<ChartTooltip currency={baseCurrency} names={seriesNames} />}
                    cursor={{ fill: "var(--muted)" }}
                  />
                  {compareYoy && (
                    <Bar
                      dataKey="previous_revenue"
                      fill="var(--chart-bar-2)"
                      radius={[2, 2, 0, 0]}
                      maxBarSize={9}
                      isAnimationActive={false}
                    />
                  )}
                  <Bar
                    dataKey="revenue"
                    fill="var(--chart-bar)"
                    radius={[2, 2, 0, 0]}
                    maxBarSize={compareYoy ? 9 : 16}
                    isAnimationActive={false}
                  >
                    {chartData.map((row: any) => (
                      <Cell key={row.month} fill={row.revenue_fill} />
                    ))}
                    {!compareYoy && (
                      <LabelList
                        dataKey="revenue"
                        content={({ x, y, width, value, index }: any) =>
                          index === lastIndex && value > 0 ? (
                            <text
                              x={x + width + 2}
                              y={y - 6}
                              textAnchor="end"
                              fontSize={11}
                              fontWeight={600}
                              fill="var(--foreground)"
                              stroke="var(--card)"
                              strokeWidth={3}
                              paintOrder="stroke"
                            >
                              {formatCurrency(value, baseCurrency)}
                            </text>
                          ) : null
                        }
                      />
                    )}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
      </div>

      {/* Top customers by revenue */}
      <Card className="gap-0 py-0">
        <PanelHeader
          title={t("dashboard.top_customers")}
          hint={t("dashboard.top_customers_eyebrow")}
        >
          <button type="button" onClick={() => navigate("/customers")} className={panelLink}>
            {t("common.view_all")} <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </PanelHeader>
        {topCustomers.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t("dashboard.no_revenue_yet")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>{t("invoices.customer")}</TableHead>
                <TableHead className="text-right">{t("dashboard.invoices")}</TableHead>
                <TableHead className="w-[38%] pl-8">{t("dashboard.share_of_revenue")}</TableHead>
                <TableHead className="text-right">{t("dashboard.revenue")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topCustomers.map((c: any, i: number) => {
                const revenue = c.total_revenue ?? 0;
                const share = revenueBase > 0 ? (revenue / revenueBase) * 100 : 0;
                return (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() =>
                      navigate(
                        `/invoices/all?customer_id=${encodeURIComponent(c.id)}&customer_name=${encodeURIComponent(c.name)}`,
                      )
                    }
                  >
                    <TableCell className="text-secondary-foreground tabular-nums">
                      {i + 1}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate font-semibold">{c.name}</TableCell>
                    <TableCell className="text-right text-secondary-foreground tabular-nums">
                      {c.invoice_count ?? 0}
                    </TableCell>
                    <TableCell className="pl-8">
                      <div className="flex items-center gap-4">
                        <div className="h-1 min-w-10 flex-1 overflow-hidden rounded-full bg-accent">
                          <div
                            className="h-full rounded-full bg-chart-bar"
                            style={{
                              width: `${topRevenue > 0 ? (revenue / topRevenue) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <span className="w-12 text-right text-xs text-secondary-foreground tabular-nums">
                          {share.toFixed(1)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatCurrency(revenue, baseCurrency)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
