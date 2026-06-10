import {
  Download,
  Eye,
  FileText,
  Globe,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { BatchActionToolbar } from "@/components/shared/BatchActionToolbar";
import {
  ColumnVisibilityMenu,
  useColumnVisibility,
} from "@/components/shared/ColumnVisibilityMenu";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DateRangeFilter } from "@/components/shared/DateRangeFilter";
import { EmptyState } from "@/components/shared/EmptyState";
import { type CurrentFilters, SavedFiltersMenu } from "@/components/shared/SavedFiltersMenu";
import {
  SortableColumnHeader,
  type SortState,
  sortData,
} from "@/components/shared/SortableColumnHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNewEntityShortcut } from "@/hooks/use-new-entity-shortcut";
import { useTranslation } from "@/i18n";
import { STATUS_COLORS } from "@/lib/constants";
import { formatApiError } from "@/lib/format-api-error";
import { consumeRowHighlight } from "@/lib/highlight-row";
import { isRecordId } from "@/lib/record-id";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

const InvoiceForm = lazy(() => import("@/pages/InvoiceForm"));
const InvoiceView = lazy(() => import("@/pages/InvoiceView"));

const InvoicePageFallback = () => (
  <div className="flex items-center justify-center py-20" role="status">
    <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    <span className="sr-only">Loading...</span>
  </div>
);

const INVOICE_LIST_SEGMENTS = new Set([
  "all",
  "draft",
  "sent",
  "paid",
  "partially_paid",
  "overdue",
  "voided",
  "complete",
  "credit_notes",
  "trash",
]);

export default function Invoices() {
  const { t } = useTranslation();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState | null>(null);
  const [dateRange, setDateRange] = useState<{ from?: string; to?: string }>({});
  const [batchAction, setBatchAction] = useState<{ action: string; label: string } | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const isNew = location.pathname === "/invoices/new";
  const isEdit = location.pathname.endsWith("/edit");
  const isView = Boolean(id && isRecordId(id) && !isNew && !isEdit);
  const statusFilter = id && INVOICE_LIST_SEGMENTS.has(id) ? id : "all";
  const isTrash = statusFilter === "trash";
  const isCreditNotes = statusFilter === "credit_notes";

  const customerIdFilter = searchParams.get("customer_id");
  const customerNameFilter = searchParams.get("customer_name");

  const fetchInvoices = useCallback(async () => {
    if (isTrash) {
      const res = await api.listTrashedInvoices({ page: String(page), limit: "20" });
      setInvoices(res.data.items);
      setTotal(res.data.total);
    } else {
      const params: Record<string, string> = { page: String(page), limit: "20" };
      if (search) params.search = search;
      if (isCreditNotes) {
        params.type = "credit_note";
      } else if (statusFilter !== "all") {
        params.status = statusFilter;
      }
      if (customerIdFilter) params.customer_id = customerIdFilter;
      if (dateRange.from) params.from = dateRange.from;
      if (dateRange.to) params.to = dateRange.to;
      const res = await api.listInvoices(params);
      setInvoices(res.data.items);
      setTotal(res.data.total);
    }
  }, [page, search, statusFilter, customerIdFilter, isTrash, isCreditNotes, dateRange]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);
  useEffect(() => {
    setSelected(new Set());
  }, []);
  // Reset to page 1 whenever the route segment (status filter) changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: id triggers the effect intentionally
  useEffect(() => {
    setPage(1);
  }, [id]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    if (isNew || isEdit || isView) return;
    const hid = consumeRowHighlight("invoice");
    if (hid) {
      setHighlightId(hid);
      const timer = setTimeout(() => setHighlightId(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [isNew, isEdit, isView]);
  useEffect(() => {
    if (isNew || isEdit || isView) return;
    if (id && !INVOICE_LIST_SEGMENTS.has(id) && !isRecordId(id)) {
      navigate("/invoices/all", { replace: true });
    }
  }, [id, isNew, isEdit, isView, navigate]);

  useNewEntityShortcut(() => navigate("/invoices/new"), !isNew && !isEdit && !isView && !isTrash);

  const invoiceColumns = [
    { key: "invoice_number", label: t("invoices.invoice_number"), required: true },
    { key: "customer_name", label: t("invoices.customer") },
    { key: "issue_date", label: t("invoices.issue_date") },
    { key: "due_date", label: t("invoices.due_date") },
    { key: "total", label: t("common.total") },
    { key: "status", label: t("invoices.status") },
  ];
  const { isVisible: isColVisible } = useColumnVisibility("inkvoice-cols-invoices");
  const visibleColCount = 1 + invoiceColumns.filter((c) => isColVisible(c.key)).length; // +1 for checkbox col

  if (isNew || isEdit) {
    return (
      <Suspense fallback={<InvoicePageFallback />}>
        <InvoiceForm
          onSave={(invId) => {
            navigate(`/invoices/${invId}`);
          }}
        />
      </Suspense>
    );
  }

  if (isView) {
    return (
      <Suspense fallback={<InvoicePageFallback />}>
        <InvoiceView
          onBack={() => {
            navigate("/invoices/all");
            fetchInvoices();
          }}
        />
      </Suspense>
    );
  }

  const sorted = sortData(invoices, sort);
  const allIds = sorted.map((inv: any) => inv.id);
  const allSelected = allIds.length > 0 && allIds.every((id: string) => selected.has(id));
  const someSelected = allIds.some((id: string) => selected.has(id));
  const totalPages = Math.ceil(total / 20);

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allIds));
  };

  const handleSort = (key: string, direction: "asc" | "desc" | null) => {
    setSort(direction ? { key, direction } : null);
  };

  const executeBatch = async () => {
    if (!batchAction) return;
    setBatchLoading(true);
    try {
      if (isTrash) {
        const res = await api.batchTrashInvoices(Array.from(selected), batchAction.action);
        if (res.data.succeeded > 0)
          toast.success(
            t("invoices.batch_success", {
              count: res.data.succeeded,
              action: batchAction.action === "restore" ? "restored" : "permanently deleted",
            }),
          );
        if (res.data.failed > 0)
          toast.error(t("invoices.batch_failed", { count: res.data.failed }));
      } else {
        const res = await api.batchInvoices(Array.from(selected), batchAction.action);
        if (res.data.succeeded > 0)
          toast.success(
            t("invoices.batch_success", {
              count: res.data.succeeded,
              action: batchAction.action === "delete" ? "moved to trash" : "updated",
            }),
          );
        if (res.data.failed > 0)
          toast.error(t("invoices.batch_failed", { count: res.data.failed }));
      }
      setSelected(new Set());
      fetchInvoices();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setBatchLoading(false);
      setBatchAction(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">
          {isTrash ? t("invoices.trash") : t("invoices.title")}
        </h1>
        {!isTrash && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const params: Record<string, string> = {};
                if (search) params.search = search;
                if (statusFilter !== "all") params.status = statusFilter;
                if (customerIdFilter) params.customer_id = customerIdFilter;
                if (dateRange.from) params.from = dateRange.from;
                if (dateRange.to) params.to = dateRange.to;
                window.open(api.exportCsvUrl("invoices", params), "_blank");
              }}
            >
              <Download className="h-4 w-4 mr-2" /> {t("common.export_csv")}
            </Button>
            <Button
              onClick={() => navigate("/invoices/new")}
              title={`${t("invoices.new_invoice")} (N)`}
            >
              <Plus className="h-4 w-4 mr-2" /> {t("invoices.new_invoice")}
            </Button>
            <ColumnVisibilityMenu storageKey="inkvoice-cols-invoices" columns={invoiceColumns} />
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <Tabs value={statusFilter} onValueChange={(v) => navigate(`/invoices/${v}`)}>
          <TabsList>
            <TabsTrigger value="all">{t("invoices.tab_all")}</TabsTrigger>
            <TabsTrigger value="draft">{t("invoices.tab_draft")}</TabsTrigger>
            <TabsTrigger value="sent">{t("invoices.tab_sent")}</TabsTrigger>
            <TabsTrigger value="paid">{t("invoices.tab_paid")}</TabsTrigger>
            <TabsTrigger value="partially_paid">{t("invoices.tab_partial")}</TabsTrigger>
            <TabsTrigger value="overdue">{t("invoices.tab_overdue")}</TabsTrigger>
            <TabsTrigger value="voided">{t("invoices.tab_voided")}</TabsTrigger>
            <TabsTrigger value="complete">{t("invoices.tab_complete")}</TabsTrigger>
            <TabsTrigger value="credit_notes" className="gap-1">
              <ReceiptText className="h-3.5 w-3.5" /> {t("invoices.tab_credit_notes")}
            </TabsTrigger>
            <TabsTrigger value="trash" className="gap-1">
              <Trash2 className="h-3.5 w-3.5" /> {t("invoices.tab_trash")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {!isTrash && (
          <div className="flex items-center gap-3">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("invoices.search_placeholder")}
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
            <SavedFiltersMenu
              storageKey="inkvoice-saved-filters-invoices"
              current={{
                segment: statusFilter,
                date_from: dateRange.from,
                date_to: dateRange.to,
                search: search || undefined,
              }}
              onApply={(preset: CurrentFilters) => {
                setSearch(preset.search ?? "");
                setDateRange({ from: preset.date_from, to: preset.date_to });
                setPage(1);
                if (preset.segment !== statusFilter) {
                  navigate(`/invoices/${preset.segment}`);
                }
              }}
            />
          </div>
        )}
      </div>

      {customerNameFilter && !isTrash && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("common.filtered_by")} <Badge variant="secondary">{customerNameFilter}</Badge>
          <Button variant="ghost" size="xs" onClick={() => navigate("/invoices/all")}>
            {t("common.clear")}
          </Button>
        </div>
      )}

      {isTrash ? (
        <BatchActionToolbar selectedCount={selected.size} onClear={() => setSelected(new Set())}>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setBatchAction({ action: "restore", label: t("invoices.restore") })}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> {t("invoices.restore")}
          </Button>
          <Button
            size="xs"
            variant="destructive"
            onClick={() =>
              setBatchAction({
                action: "permanent-delete",
                label: t("invoices.delete_permanently"),
              })
            }
          >
            {t("invoices.delete_permanently")}
          </Button>
        </BatchActionToolbar>
      ) : (
        <BatchActionToolbar selectedCount={selected.size} onClear={() => setSelected(new Set())}>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setBatchAction({ action: "mark-sent", label: t("invoices.mark_sent") })}
          >
            {t("invoices.mark_sent")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setBatchAction({ action: "mark-paid", label: t("invoices.mark_paid") })}
          >
            {t("invoices.mark_paid")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setBatchAction({ action: "void", label: t("invoices.void") })}
          >
            {t("invoices.void")}
          </Button>
          <Button
            size="xs"
            variant="destructive"
            onClick={() => setBatchAction({ action: "delete", label: t("common.delete") })}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" /> {t("common.delete")}
          </Button>
        </BatchActionToolbar>
      )}

      <div className="glass-table-wrapper">
        <Table stickyFirstColumn>
          <TableHeader>
            <TableRow>
              <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  onCheckedChange={toggleAll}
                />
              </TableCell>
              {isColVisible("invoice_number") && (
                <SortableColumnHeader
                  label={t("invoices.invoice_number")}
                  sortKey="invoice_number"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
              {isColVisible("customer_name") && (
                <SortableColumnHeader
                  label={t("invoices.customer")}
                  sortKey="customer_name"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
              {isColVisible("issue_date") && (
                <SortableColumnHeader
                  label={t("invoices.issue_date")}
                  sortKey="issue_date"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
              {isColVisible("due_date") && (
                <SortableColumnHeader
                  label={t("invoices.due_date")}
                  sortKey="due_date"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
              {isColVisible("total") && (
                <SortableColumnHeader
                  label={t("common.total")}
                  sortKey="total"
                  currentSort={sort}
                  onSort={handleSort}
                  className="text-right"
                />
              )}
              {isColVisible("status") && (
                <SortableColumnHeader
                  label={t("invoices.status")}
                  sortKey="status"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={visibleColCount} className="p-0">
                  {isTrash ? (
                    <EmptyState
                      icon={Trash2}
                      title={t("invoices.trash_empty")}
                      description={t("invoices.trash_empty_description")}
                    />
                  ) : (
                    <EmptyState
                      icon={FileText}
                      title={t("invoices.empty_title")}
                      description={t("invoices.empty_description")}
                      actionLabel={t("invoices.new_invoice")}
                      onAction={() => navigate("/invoices/new")}
                    />
                  )}
                </TableCell>
              </TableRow>
            )}
            {sorted.map((inv: any) => {
              const daysOverdue =
                inv.status === "overdue" && inv.due_date
                  ? Math.max(
                      0,
                      Math.floor(
                        (Date.now() - new Date(inv.due_date).getTime()) / (1000 * 60 * 60 * 24),
                      ),
                    )
                  : 0;
              const isOverdue = inv.status === "overdue";
              return (
                <TableRow
                  key={inv.id}
                  className={cn(
                    isTrash
                      ? "hover:bg-accent/50 transition-colors"
                      : "cursor-pointer hover:bg-accent/50 transition-colors",
                    isOverdue && "row-overdue",
                    highlightId === inv.id && "row-just-created",
                  )}
                  onClick={isTrash ? undefined : () => navigate(`/invoices/${inv.id}`)}
                >
                  <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(inv.id)}
                      onCheckedChange={() => toggleSelect(inv.id)}
                    />
                  </TableCell>
                  {isColVisible("invoice_number") && (
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {inv.type === "credit_note" && (
                          <ReceiptText className="h-3.5 w-3.5 text-amber-600" />
                        )}
                        {inv.invoice_number}
                        {!!inv.is_published && (
                          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        {inv.first_viewed_at && (
                          <span
                            role="img"
                            title={t("invoices.viewed_on", {
                              date: formatDate(inv.last_viewed_at || inv.first_viewed_at),
                            })}
                            aria-label={t("invoices.viewed")}
                          >
                            <Eye className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                          </span>
                        )}
                      </span>
                    </TableCell>
                  )}
                  {isColVisible("customer_name") && <TableCell>{inv.customer_name}</TableCell>}
                  {isColVisible("issue_date") && (
                    <TableCell className="text-muted-foreground">
                      {formatDate(inv.issue_date)}
                    </TableCell>
                  )}
                  {isColVisible("due_date") && (
                    <TableCell className="text-muted-foreground">
                      {inv.due_date ? formatDate(inv.due_date) : "-"}
                    </TableCell>
                  )}
                  {isColVisible("total") && (
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatCurrency(inv.total, inv.currency)}
                    </TableCell>
                  )}
                  {isColVisible("status") && (
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className={STATUS_COLORS[inv.status]}>
                          {t(`invoices.status_${inv.status}`)}
                        </Badge>
                        {isOverdue && daysOverdue > 0 && (
                          <span className="text-[11px] text-red-600 dark:text-red-400 tabular-nums">
                            {t("invoices.days_overdue", { count: String(daysOverdue) })}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
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

      <ConfirmDialog
        open={!!batchAction}
        onOpenChange={(open) => {
          if (!open) setBatchAction(null);
        }}
        title={`${batchAction?.label} ${selected.size} invoice(s)?`}
        description={
          {
            delete: t("invoices.confirm_delete"),
            "permanent-delete": t("invoices.confirm_permanent_delete"),
            restore: t("invoices.confirm_restore"),
          }[batchAction?.action ?? ""] ??
          t("invoices.confirm_batch", { action: batchAction?.label.toLowerCase() ?? "" })
        }
        confirmLabel={batchAction?.label || t("common.confirm")}
        variant={
          batchAction?.action === "delete" ||
          batchAction?.action === "permanent-delete" ||
          batchAction?.action === "void"
            ? "destructive"
            : "default"
        }
        onConfirm={executeBatch}
        loading={batchLoading}
      />
    </div>
  );
}
