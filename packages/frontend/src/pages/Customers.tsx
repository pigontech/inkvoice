import { Download, Pencil, Plus, Search, Trash2, Upload, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useNewEntityShortcut } from "@/hooks/use-new-entity-shortcut";
import { useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";
import { consumeRowHighlight } from "@/lib/highlight-row";
import { cn } from "@/lib/utils";
import CustomerForm from "@/pages/CustomerForm";

export default function Customers() {
  const { t } = useTranslation();
  const [customers, setCustomers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
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
  const { id } = useParams();
  const isForm =
    location.pathname.includes("/new") || (id && location.pathname.includes("/customers/"));

  const fetchCustomers = useCallback(async () => {
    const params: Record<string, string> = { page: String(page), limit: "20" };
    if (search) params.search = search;
    const res = await api.listCustomers(params);
    setCustomers(res.data.items);
    setTotal(res.data.total);
  }, [page, search]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);
  useEffect(() => {
    setSelected(new Set());
  }, []);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    if (isForm) return;
    const id = consumeRowHighlight("customer");
    if (id) {
      setHighlightId(id);
      const t = setTimeout(() => setHighlightId(null), 5000);
      return () => clearTimeout(t);
    }
  }, [isForm]);

  useNewEntityShortcut(() => navigate("/customers/new"), !isForm);

  const customerColumns = [
    { key: "name", label: t("customers.name"), required: true },
    { key: "email", label: t("customers.email") },
    { key: "phone", label: t("customers.phone") },
    { key: "invoice_count", label: t("nav.invoices") },
  ];
  const { isVisible: isColVisible } = useColumnVisibility("inkvoice-cols-customers");
  const visibleColCount = 1 + customerColumns.filter((c) => isColVisible(c.key)).length + 1; // checkbox + actions

  if (isForm) {
    return (
      <CustomerForm
        onSave={() => {
          navigate("/customers");
          fetchCustomers();
        }}
      />
    );
  }

  const sorted = sortData(customers, sort);
  const allIds = sorted.map((c: any) => c.id);
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

  const handleDelete = async () => {
    if (!deleteConfirm.id) return;
    setActionLoading(true);
    try {
      await api.deleteCustomer(deleteConfirm.id);
      toast.success(t("customers.customer_deleted"));
      fetchCustomers();
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
      const res = await api.batchCustomers(Array.from(selected), "delete");
      if (res.data.succeeded > 0)
        toast.success(t("customers.batch_deleted", { count: res.data.succeeded }));
      if (res.data.failed > 0)
        toast.error(t("customers.batch_delete_failed", { count: res.data.failed }));
      setSelected(new Set());
      fetchCustomers();
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
        <h1 className="text-2xl font-bold tracking-tight">{t("customers.title")}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" /> {t("import.import_button")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const params: Record<string, string> = {};
              if (search) params.search = search;
              window.open(api.exportCsvUrl("customers", params), "_blank");
            }}
          >
            <Download className="h-4 w-4 mr-2" /> {t("common.export_csv")}
          </Button>
          <Button
            onClick={() => navigate("/customers/new")}
            title={`${t("customers.add_customer")} (N)`}
          >
            <Plus className="h-4 w-4 mr-2" /> {t("customers.add_customer")}
          </Button>
          <ColumnVisibilityMenu storageKey="inkvoice-cols-customers" columns={customerColumns} />
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("customers.search_placeholder")}
          aria-label={t("common.search")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="pl-9"
        />
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
              {isColVisible("name") && (
                <SortableColumnHeader
                  label={t("customers.name")}
                  sortKey="name"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
              {isColVisible("email") && (
                <SortableColumnHeader
                  label={t("customers.email")}
                  sortKey="email"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
              {isColVisible("phone") && (
                <SortableColumnHeader
                  label={t("customers.phone")}
                  sortKey="phone"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
              {isColVisible("invoice_count") && (
                <SortableColumnHeader
                  label={t("nav.invoices")}
                  sortKey="invoice_count"
                  currentSort={sort}
                  onSort={handleSort}
                  className="text-right"
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
                    icon={Users}
                    title={t("customers.empty_title")}
                    description={t("customers.empty_description")}
                    actionLabel={t("customers.add_customer")}
                    onAction={() => navigate("/customers/new")}
                  />
                </TableCell>
              </TableRow>
            )}
            {sorted.map((c: any) => (
              <TableRow
                key={c.id}
                className={cn(
                  "cursor-pointer hover:bg-accent/50 transition-colors",
                  highlightId === c.id && "row-just-created",
                )}
                onClick={() => navigate(`/customers/${c.id}`)}
              >
                <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(c.id)}
                    onCheckedChange={() => toggleSelect(c.id)}
                  />
                </TableCell>
                {isColVisible("name") && <TableCell className="font-medium">{c.name}</TableCell>}
                {isColVisible("email") && (
                  <TableCell className="text-muted-foreground">{c.email || "-"}</TableCell>
                )}
                {isColVisible("phone") && (
                  <TableCell className="text-muted-foreground">{c.phone || "-"}</TableCell>
                )}
                {isColVisible("invoice_count") && (
                  <TableCell
                    className="text-right tabular-nums"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {(c.invoice_count ?? 0) > 0 ? (
                      <button
                        className="text-primary hover:underline"
                        onClick={() =>
                          navigate(
                            `/invoices?customer_id=${c.id}&customer_name=${encodeURIComponent(c.name)}`,
                          )
                        }
                      >
                        {c.invoice_count}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                )}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("common.edit")}
                      onClick={() => navigate(`/customers/${c.id}/edit`)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("common.delete")}
                      onClick={() => setDeleteConfirm({ open: true, id: c.id })}
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
        title={t("customers.delete_title")}
        description={t("customers.delete_description")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDelete}
        loading={actionLoading}
      />

      <ConfirmDialog
        open={batchDeleteOpen}
        onOpenChange={setBatchDeleteOpen}
        title={t("customers.batch_delete_title", { count: selected.size })}
        description={t("customers.batch_delete_description")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleBatchDelete}
        loading={actionLoading}
      />

      <CsvImportDialog
        resource="customers"
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchCustomers}
      />
    </div>
  );
}
