import { Download, Pencil, Plus, Receipt, Search, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { BatchActionToolbar } from "@/components/shared/BatchActionToolbar";
import {
  ColumnVisibilityMenu,
  useColumnVisibility,
} from "@/components/shared/ColumnVisibilityMenu";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { CsvImportDialog } from "@/components/shared/CsvImportDialog";
import { EmptyState } from "@/components/shared/EmptyState";
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
import { formatApiError } from "@/lib/format-api-error";
import { consumeRowHighlight } from "@/lib/highlight-row";
import { isRecordId } from "@/lib/record-id";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import ExpenseForm from "@/pages/ExpenseForm";

type BillableFilter = "all" | "billable" | "unbilled";

export default function Expenses() {
  const { t } = useTranslation();
  const [expenses, setExpenses] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [billable, setBillable] = useState<BillableFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id?: string }>();
  const isNew = location.pathname === "/expenses/new";
  const isForm = isNew || (!!id && isRecordId(id));

  const fetchExpenses = useCallback(async () => {
    const params: Record<string, string> = { page: String(page), limit: "20" };
    if (search) params.search = search;
    if (billable !== "all") params.billable = billable === "billable" ? "true" : "false";
    const res = await api.listExpenses(params);
    setExpenses(res.data.items);
    setTotal(res.data.total);
  }, [page, search, billable]);

  useEffect(() => {
    if (!isForm) fetchExpenses();
  }, [fetchExpenses, isForm]);

  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    if (isForm) return;
    const hid = consumeRowHighlight("expense");
    if (hid) {
      setHighlightId(hid);
      const tmr = setTimeout(() => setHighlightId(null), 5000);
      return () => clearTimeout(tmr);
    }
  }, [isForm]);

  useNewEntityShortcut(() => navigate("/expenses/new"), !isForm);

  const expenseColumns = [
    { key: "expense_date", label: t("expenses.date"), required: true },
    { key: "vendor", label: t("expenses.vendor") },
    { key: "category", label: t("expenses.category") },
    { key: "customer", label: t("expenses.customer") },
    { key: "total", label: t("expenses.amount") },
    { key: "billable", label: t("expenses.billable") },
  ];
  const { isVisible: isColVisible } = useColumnVisibility("inkvoice-cols-expenses");
  const visibleColCount = 1 + expenseColumns.filter((c) => isColVisible(c.key)).length + 1;

  if (isForm) {
    return (
      <ExpenseForm
        onSave={() => {
          navigate("/expenses");
          fetchExpenses();
        }}
      />
    );
  }

  const sorted = sortData(expenses, sort);
  const allIds = sorted.map((e: any) => e.id);
  const allSelected = allIds.length > 0 && allIds.every((x: string) => selected.has(x));
  const someSelected = allIds.some((x: string) => selected.has(x));
  const totalPages = Math.ceil(total / 20);

  const toggleSelect = (rowId: string) => {
    const next = new Set(selected);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    setSelected(next);
  };
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allIds));
  };
  const handleSort = (key: string, direction: "asc" | "desc" | null) => {
    setSort(direction ? { key, direction } : null);
  };

  const handleDelete = async () => {
    if (!deleteConfirm.id) return;
    setActionLoading(true);
    try {
      await api.deleteExpense(deleteConfirm.id);
      toast.success(t("expenses.expense_deleted"));
      fetchExpenses();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setActionLoading(false);
      setDeleteConfirm({ open: false, id: null });
    }
  };

  const handleBatchDelete = async () => {
    setActionLoading(true);
    try {
      const res = await api.batchExpenses(Array.from(selected), "delete");
      if (res.data.succeeded > 0)
        toast.success(t("expenses.batch_deleted", { count: res.data.succeeded }));
      if (res.data.failed > 0)
        toast.error(t("expenses.batch_delete_failed", { count: res.data.failed }));
      setSelected(new Set());
      fetchExpenses();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setActionLoading(false);
      setBatchDeleteOpen(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("expenses.title")}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" /> {t("import.import_button")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const params: Record<string, string> = {};
              if (search) params.search = search;
              if (billable !== "all") params.billable = billable === "billable" ? "true" : "false";
              window.open(api.exportCsvUrl("expenses", params), "_blank");
            }}
          >
            <Download className="h-4 w-4 mr-2" /> {t("common.export_csv")}
          </Button>
          <Button
            onClick={() => navigate("/expenses/new")}
            title={`${t("expenses.add_expense")} (N)`}
          >
            <Plus className="h-4 w-4 mr-2" /> {t("expenses.add_expense")}
          </Button>
          <ColumnVisibilityMenu storageKey="inkvoice-cols-expenses" columns={expenseColumns} />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <Tabs
          value={billable}
          onValueChange={(v) => {
            setBillable(v as BillableFilter);
            setPage(1);
          }}
        >
          <TabsList>
            <TabsTrigger value="all">{t("expenses.tab_all")}</TabsTrigger>
            <TabsTrigger value="billable">{t("expenses.tab_billable")}</TabsTrigger>
            <TabsTrigger value="unbilled">{t("expenses.tab_unbilled")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("expenses.search_placeholder")}
            aria-label={t("common.search")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
      </div>

      <BatchActionToolbar selectedCount={selected.size} onClear={() => setSelected(new Set())}>
        <Button size="xs" variant="destructive" onClick={() => setBatchDeleteOpen(true)}>
          {t("common.delete")}
        </Button>
      </BatchActionToolbar>

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
              {isColVisible("expense_date") && (
                <SortableColumnHeader
                  label={t("expenses.date")}
                  sortKey="expense_date"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
              {isColVisible("vendor") && (
                <SortableColumnHeader
                  label={t("expenses.vendor")}
                  sortKey="vendor"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
              {isColVisible("category") && (
                <SortableColumnHeader
                  label={t("expenses.category")}
                  sortKey="category"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
              {isColVisible("customer") && (
                <SortableColumnHeader
                  label={t("expenses.customer")}
                  sortKey="customer_name"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
              {isColVisible("total") && (
                <SortableColumnHeader
                  label={t("expenses.amount")}
                  sortKey="total"
                  currentSort={sort}
                  onSort={handleSort}
                  className="text-right"
                />
              )}
              {isColVisible("billable") && (
                <SortableColumnHeader
                  label={t("expenses.billable")}
                  sortKey="is_billable"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
              <TableCell className="w-[100px] font-medium text-sm text-muted-foreground">
                {t("common.actions")}
              </TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={visibleColCount} className="p-0">
                  <EmptyState
                    icon={Receipt}
                    title={t("expenses.empty_title")}
                    description={t("expenses.empty_description")}
                    actionLabel={t("expenses.add_expense")}
                    onAction={() => navigate("/expenses/new")}
                  />
                </TableCell>
              </TableRow>
            )}
            {sorted.map((e: any) => (
              <TableRow
                key={e.id}
                className={cn(
                  "cursor-pointer hover:bg-accent/50 transition-colors",
                  highlightId === e.id && "row-just-created",
                )}
                onClick={() => navigate(`/expenses/${e.id}`)}
              >
                <TableCell className="w-10" onClick={(ev) => ev.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(e.id)}
                    onCheckedChange={() => toggleSelect(e.id)}
                  />
                </TableCell>
                {isColVisible("expense_date") && (
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatDate(e.expense_date)}
                  </TableCell>
                )}
                {isColVisible("vendor") && (
                  <TableCell className="font-medium">{e.vendor || "-"}</TableCell>
                )}
                {isColVisible("category") && (
                  <TableCell>
                    {e.category ? (
                      <Badge variant="secondary">{e.category}</Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                )}
                {isColVisible("customer") && (
                  <TableCell className="text-muted-foreground">{e.customer_name || "-"}</TableCell>
                )}
                {isColVisible("total") && (
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatCurrency(e.total, e.currency)}
                  </TableCell>
                )}
                {isColVisible("billable") && (
                  <TableCell>
                    {e.is_billable ? (
                      <Badge
                        variant="default"
                        className={
                          e.billed_invoice_id
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25"
                            : "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25"
                        }
                      >
                        {e.billed_invoice_id ? t("expenses.billed") : t("expenses.billable")}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                )}
                <TableCell onClick={(ev) => ev.stopPropagation()}>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("common.edit")}
                      onClick={() => navigate(`/expenses/${e.id}`)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("common.delete")}
                      onClick={() => setDeleteConfirm({ open: true, id: e.id })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
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

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirm({ open: false, id: null });
        }}
        title={t("expenses.delete_title")}
        description={t("expenses.delete_description")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDelete}
        loading={actionLoading}
      />

      <ConfirmDialog
        open={batchDeleteOpen}
        onOpenChange={setBatchDeleteOpen}
        title={t("expenses.batch_delete_title", { count: selected.size })}
        description={t("expenses.batch_delete_description")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleBatchDelete}
        loading={actionLoading}
      />

      <CsvImportDialog
        resource="expenses"
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchExpenses}
      />
    </div>
  );
}
