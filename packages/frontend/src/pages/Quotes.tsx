import { FileText, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/api/client";
import { DateRangeFilter } from "@/components/shared/DateRangeFilter";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNewEntityShortcut } from "@/hooks/use-new-entity-shortcut";
import { useTranslation } from "@/i18n";
import { consumeRowHighlight } from "@/lib/highlight-row";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

const QUOTE_STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  accepted: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  expired: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  converted: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

const QUOTE_TAB_SEGMENTS = new Set(["all", "draft", "sent", "accepted", "rejected", "converted"]);

export default function Quotes() {
  const { t } = useTranslation();
  const [quotes, setQuotes] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<{ from?: string; to?: string }>({});
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const statusFilter = id && QUOTE_TAB_SEGMENTS.has(id) ? id : "all";

  const fetchQuotes = useCallback(async () => {
    const params: Record<string, string> = { page: String(page), limit: "20" };
    if (search) params.search = search;
    if (statusFilter !== "all") params.status = statusFilter;
    if (dateRange.from) params.from = dateRange.from;
    if (dateRange.to) params.to = dateRange.to;
    const res = await api.listQuotes(params);
    setQuotes(res.data.items);
    setTotal(res.data.total);
  }, [page, search, statusFilter, dateRange]);

  useEffect(() => {
    fetchQuotes();
  }, [fetchQuotes]);

  // Reset to page 1 whenever the route segment changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: id triggers the effect intentionally
  useEffect(() => {
    setPage(1);
  }, [id]);

  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    const hid = consumeRowHighlight("quote");
    if (hid) {
      setHighlightId(hid);
      const timer = setTimeout(() => setHighlightId(null), 5000);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (id && !QUOTE_TAB_SEGMENTS.has(id)) {
      navigate("/quotes/all", { replace: true });
    }
  }, [id, navigate]);

  const totalPages = Math.ceil(total / 20);

  useNewEntityShortcut(() => navigate("/quotes/new"));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("quotes.title")}</h1>
        <Button onClick={() => navigate("/quotes/new")} title={`${t("quotes.new_quote")} (N)`}>
          <Plus className="h-4 w-4 mr-2" /> {t("quotes.new_quote")}
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <Tabs value={statusFilter} onValueChange={(v) => navigate(`/quotes/${v}`)}>
          <TabsList>
            <TabsTrigger value="all">{t("quotes.tab_all")}</TabsTrigger>
            <TabsTrigger value="draft">{t("quotes.tab_draft")}</TabsTrigger>
            <TabsTrigger value="sent">{t("quotes.tab_sent")}</TabsTrigger>
            <TabsTrigger value="accepted">{t("quotes.tab_accepted")}</TabsTrigger>
            <TabsTrigger value="rejected">{t("quotes.tab_rejected")}</TabsTrigger>
            <TabsTrigger value="converted">{t("quotes.tab_converted")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("quotes.search_placeholder")}
              aria-label={t("common.search")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <DateRangeFilter
            value={dateRange}
            onChange={(r) => {
              setDateRange(r);
              setPage(1);
            }}
          />
        </div>
      </div>

      <div className="glass-table-wrapper">
        <Table stickyFirstColumn>
          <TableHeader>
            <TableRow>
              <TableCell className="font-medium text-sm text-muted-foreground">
                {t("quotes.quote_number")}
              </TableCell>
              <TableCell className="font-medium text-sm text-muted-foreground">
                {t("quotes.customer")}
              </TableCell>
              <TableCell className="font-medium text-sm text-muted-foreground">
                {t("quotes.issue_date")}
              </TableCell>
              <TableCell className="font-medium text-sm text-muted-foreground">
                {t("quotes.valid_until")}
              </TableCell>
              <TableCell className="font-medium text-sm text-muted-foreground text-right">
                {t("common.total")}
              </TableCell>
              <TableCell className="font-medium text-sm text-muted-foreground">
                {t("quotes.status")}
              </TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="p-0">
                  <EmptyState
                    icon={FileText}
                    title={t("quotes.empty_title")}
                    description={t("quotes.empty_description")}
                    actionLabel={t("quotes.new_quote")}
                    onAction={() => navigate("/quotes/new")}
                  />
                </TableCell>
              </TableRow>
            )}
            {quotes.map((q: any) => (
              <TableRow
                key={q.id}
                className={cn(
                  "cursor-pointer hover:bg-accent/50 transition-colors",
                  highlightId === q.id && "row-just-created",
                )}
                onClick={() => navigate(`/quotes/${q.id}`)}
              >
                <TableCell className="font-medium">{q.quote_number}</TableCell>
                <TableCell>{q.customer_name}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(q.issue_date)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {q.valid_until ? formatDate(q.valid_until) : "-"}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {formatCurrency(q.total, q.currency)}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className={QUOTE_STATUS_COLORS[q.status]}>
                    {q.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t("common.previous")}
          </Button>
          <span className="text-sm py-2 text-muted-foreground tabular-nums">
            {t("common.page_of", { page: String(page), total: String(totalPages) })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            {t("common.next")}
          </Button>
        </div>
      )}
    </div>
  );
}
