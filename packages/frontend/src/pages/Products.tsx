import { Download, Package, Pencil, Plus, RotateCcw, Search, Trash2, Upload } from "lucide-react";
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
import { cn, formatCurrency } from "@/lib/utils";
import ProductForm from "@/pages/ProductForm";

const PRODUCT_CATEGORY_SEGMENTS = new Set(["all", "service", "goods", "subscription"]);

export default function Products() {
  const { t } = useTranslation();
  const [products, setProducts] = useState<any[]>([]);
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
  const location = useLocation();
  const { id } = useParams<{ id?: string }>();
  const isNew = location.pathname === "/products/new";
  const isForm = isNew || (!!id && isRecordId(id));
  const category = id && PRODUCT_CATEGORY_SEGMENTS.has(id) ? id : "all";

  const fetchProducts = useCallback(async () => {
    const params: Record<string, string> = { page: String(page), limit: "20" };
    if (search) params.search = search;
    if (category !== "all") params.category = category;
    const res = await api.listProducts(params);
    setProducts(res.data.items);
    setTotal(res.data.total);
  }, [page, search, category]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);
  useEffect(() => {
    setSelected(new Set());
  }, []);
  // Reset to page 1 whenever the route segment changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: id triggers the effect intentionally
  useEffect(() => {
    setPage(1);
  }, [id]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    if (isForm) return;
    const hid = consumeRowHighlight("product");
    if (hid) {
      setHighlightId(hid);
      const t = setTimeout(() => setHighlightId(null), 5000);
      return () => clearTimeout(t);
    }
  }, [isForm]);
  useEffect(() => {
    if (isNew || isForm) return;
    if (id && !PRODUCT_CATEGORY_SEGMENTS.has(id) && !isRecordId(id)) {
      navigate("/products/all", { replace: true });
    }
  }, [id, isNew, isForm, navigate]);

  useNewEntityShortcut(() => navigate("/products/new"), !isForm);

  const productColumns = [
    { key: "name", label: t("products.name"), required: true },
    { key: "sku", label: t("products.sku") },
    { key: "unit_price", label: t("products.unit_price") },
    { key: "unit", label: t("products.unit") },
    { key: "category", label: t("products.category") },
    { key: "status", label: t("products.status") },
  ];
  const { isVisible: isColVisible } = useColumnVisibility("inkvoice-cols-products");
  const visibleColCount = 1 + productColumns.filter((c) => isColVisible(c.key)).length + 1; // checkbox + actions

  if (isForm) {
    return (
      <ProductForm
        onSave={() => {
          navigate("/products/all");
          fetchProducts();
        }}
      />
    );
  }

  const sorted = sortData(products, sort);
  const allIds = sorted.map((p: any) => p.id);
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
      await api.deleteProduct(deleteConfirm.id);
      toast.success(t("products.product_deleted"));
      fetchProducts();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setActionLoading(false);
      setDeleteConfirm({ open: false, id: null });
    }
  };

  const handleReactivate = async (productId: string) => {
    try {
      await api.reactivateProduct(productId);
      toast.success(t("products.product_reactivated"));
      fetchProducts();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    }
  };

  const handleBatchDelete = async () => {
    setActionLoading(true);
    try {
      const res = await api.batchProducts(Array.from(selected), "delete");
      if (res.data.succeeded > 0)
        toast.success(t("products.batch_deleted", { count: res.data.succeeded }));
      if (res.data.failed > 0)
        toast.error(t("products.batch_delete_failed", { count: res.data.failed }));
      setSelected(new Set());
      fetchProducts();
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
        <h1 className="text-2xl font-bold tracking-tight">{t("products.title")}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" /> {t("import.import_button")}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const params: Record<string, string> = {};
              if (search) params.search = search;
              if (category !== "all") params.category = category;
              window.open(api.exportCsvUrl("products", params), "_blank");
            }}
          >
            <Download className="h-4 w-4 mr-2" /> {t("common.export_csv")}
          </Button>
          <Button
            onClick={() => navigate("/products/new")}
            title={`${t("products.add_product")} (N)`}
          >
            <Plus className="h-4 w-4 mr-2" /> {t("products.add_product")}
          </Button>
          <ColumnVisibilityMenu storageKey="inkvoice-cols-products" columns={productColumns} />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <Tabs value={category} onValueChange={(v) => navigate(`/products/${v}`)}>
          <TabsList>
            <TabsTrigger value="all">{t("products.tab_all")}</TabsTrigger>
            <TabsTrigger value="service">{t("products.tab_service")}</TabsTrigger>
            <TabsTrigger value="goods">{t("products.tab_goods")}</TabsTrigger>
            <TabsTrigger value="subscription">{t("products.tab_subscription")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("products.search_placeholder")}
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
              {isColVisible("name") && (
                <SortableColumnHeader
                  label={t("products.name")}
                  sortKey="name"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
              {isColVisible("sku") && (
                <SortableColumnHeader
                  label={t("products.sku")}
                  sortKey="sku"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
              {isColVisible("unit_price") && (
                <SortableColumnHeader
                  label={t("products.unit_price")}
                  sortKey="unit_price"
                  currentSort={sort}
                  onSort={handleSort}
                  className="text-right"
                />
              )}
              {isColVisible("unit") && (
                <SortableColumnHeader
                  label={t("products.unit")}
                  sortKey="unit"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
              {isColVisible("category") && (
                <SortableColumnHeader
                  label={t("products.category")}
                  sortKey="category"
                  currentSort={sort}
                  onSort={handleSort}
                />
              )}
              {isColVisible("status") && (
                <SortableColumnHeader
                  label={t("products.status")}
                  sortKey="is_active"
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
                    icon={Package}
                    title={t("products.empty_title")}
                    description={t("products.empty_description")}
                    actionLabel={t("products.add_product")}
                    onAction={() => navigate("/products/new")}
                  />
                </TableCell>
              </TableRow>
            )}
            {sorted.map((p: any) => (
              <TableRow
                key={p.id}
                className={cn(
                  "cursor-pointer hover:bg-accent/50 transition-colors",
                  highlightId === p.id && "row-just-created",
                )}
                onClick={() => navigate(`/products/${p.id}`)}
              >
                <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(p.id)}
                    onCheckedChange={() => toggleSelect(p.id)}
                  />
                </TableCell>
                {isColVisible("name") && <TableCell className="font-medium">{p.name}</TableCell>}
                {isColVisible("sku") && (
                  <TableCell className="text-muted-foreground">{p.sku || "-"}</TableCell>
                )}
                {isColVisible("unit_price") && (
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatCurrency(p.unit_price)}
                  </TableCell>
                )}
                {isColVisible("unit") && (
                  <TableCell className="text-muted-foreground capitalize">{p.unit}</TableCell>
                )}
                {isColVisible("category") && (
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {p.category}
                    </Badge>
                  </TableCell>
                )}
                {isColVisible("status") && (
                  <TableCell>
                    <Badge
                      variant={p.is_active ? "default" : "secondary"}
                      className={
                        p.is_active
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25"
                          : ""
                      }
                    >
                      {p.is_active ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </TableCell>
                )}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex gap-1">
                    {!p.is_active && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("products.reactivate")}
                        onClick={() => handleReactivate(p.id)}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("common.edit")}
                      onClick={() => navigate(`/products/${p.id}`)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("common.delete")}
                      onClick={() => setDeleteConfirm({ open: true, id: p.id })}
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
        title={t("products.delete_title")}
        description={t("products.delete_description")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDelete}
        loading={actionLoading}
      />

      <ConfirmDialog
        open={batchDeleteOpen}
        onOpenChange={setBatchDeleteOpen}
        title={t("products.batch_delete_title", { count: selected.size })}
        description={t("products.batch_delete_description")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleBatchDelete}
        loading={actionLoading}
      />

      <CsvImportDialog
        resource="products"
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchProducts}
      />
    </div>
  );
}
