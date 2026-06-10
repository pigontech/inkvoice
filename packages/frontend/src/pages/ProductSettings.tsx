import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FormField } from "@/components/shared/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";

type Category = { id: string; name: string; is_builtin: number };
type Unit = { id: string; name: string; symbol: string | null; is_builtin: number };

export default function ProductSettings() {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);

  const [editDialog, setEditDialog] = useState<{
    open: boolean;
    type: "category" | "unit";
    item: Category | Unit | null;
  }>({ open: false, type: "category", item: null });

  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    type: "category" | "unit";
    id: string | null;
  }>({ open: false, type: "category", id: null });

  const [formName, setFormName] = useState("");
  const [formSymbol, setFormSymbol] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchCategories = useCallback(async () => {
    const res = await api.listProductCategories();
    setCategories(res.data);
  }, []);

  const fetchUnits = useCallback(async () => {
    const res = await api.listProductUnits();
    setUnits(res.data);
  }, []);

  useEffect(() => {
    fetchCategories();
    fetchUnits();
  }, [fetchCategories, fetchUnits]);

  const openCreate = (type: "category" | "unit") => {
    setFormName("");
    setFormSymbol("");
    setEditDialog({ open: true, type, item: null });
  };

  const openEdit = (type: "category" | "unit", item: Category | Unit) => {
    setFormName(item.name);
    setFormSymbol(type === "unit" ? (item as Unit).symbol || "" : "");
    setEditDialog({ open: true, type, item });
  };

  const handleSave = async () => {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      const isEdit = editDialog.item !== null;
      if (editDialog.type === "category") {
        if (isEdit) {
          await api.updateProductCategory(editDialog.item!.id, { name: formName.trim() });
          toast.success(t("product_settings.category_updated"));
        } else {
          await api.createProductCategory({ name: formName.trim() });
          toast.success(t("product_settings.category_created"));
        }
        await fetchCategories();
      } else {
        if (isEdit) {
          await api.updateProductUnit(editDialog.item!.id, {
            name: formName.trim(),
            symbol: formSymbol.trim() || undefined,
          });
          toast.success(t("product_settings.unit_updated"));
        } else {
          await api.createProductUnit({
            name: formName.trim(),
            symbol: formSymbol.trim() || undefined,
          });
          toast.success(t("product_settings.unit_created"));
        }
        await fetchUnits();
      }
      setEditDialog({ open: false, type: "category", item: null });
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm.id) return;
    setDeleting(true);
    try {
      if (deleteConfirm.type === "category") {
        await api.deleteProductCategory(deleteConfirm.id);
        toast.success(t("product_settings.category_deleted"));
        await fetchCategories();
      } else {
        await api.deleteProductUnit(deleteConfirm.id);
        toast.success(t("product_settings.unit_deleted"));
        await fetchUnits();
      }
      setDeleteConfirm({ open: false, type: "category", id: null });
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-semibold">{t("product_settings.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("product_settings.subtitle")}</p>
      </div>

      {/* Product Categories */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold">{t("product_settings.categories_title")}</h3>
          <Button size="sm" onClick={() => openCreate("category")}>
            <Plus className="h-4 w-4 mr-1" />
            {t("product_settings.add_category")}
          </Button>
        </div>
        <div className="divide-y rounded-xl border bg-card">
          {categories.map((cat) => (
            <div key={cat.id} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0">
                <div className="font-medium">
                  {cat.name.charAt(0).toUpperCase() + cat.name.slice(1)}
                </div>
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  {cat.name}
                  {cat.is_builtin === 1 && (
                    <Badge variant="secondary" className="text-xs">
                      {t("product_settings.builtin")}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-xs" onClick={() => openEdit("category", cat)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {cat.is_builtin !== 1 && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setDeleteConfirm({ open: true, type: "category", id: cat.id })}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Product Units */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold">{t("product_settings.units_title")}</h3>
          <Button size="sm" onClick={() => openCreate("unit")}>
            <Plus className="h-4 w-4 mr-1" />
            {t("product_settings.add_unit")}
          </Button>
        </div>
        <div className="divide-y rounded-xl border bg-card">
          {units.map((unit) => (
            <div key={unit.id} className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0">
                <div className="font-medium">
                  {unit.name.charAt(0).toUpperCase() + unit.name.slice(1)}
                </div>
                <div className="text-sm text-muted-foreground flex items-center gap-2">
                  {unit.symbol || unit.name}
                  {unit.is_builtin === 1 && (
                    <Badge variant="secondary" className="text-xs">
                      {t("product_settings.builtin")}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-xs" onClick={() => openEdit("unit", unit)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {unit.is_builtin !== 1 && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setDeleteConfirm({ open: true, type: "unit", id: unit.id })}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog
        open={editDialog.open}
        onOpenChange={(open) => {
          if (!open) setEditDialog({ open: false, type: "category", item: null });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editDialog.item
                ? editDialog.type === "category"
                  ? t("product_settings.edit_category")
                  : t("product_settings.edit_unit")
                : editDialog.type === "category"
                  ? t("product_settings.add_category")
                  : t("product_settings.add_unit")}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
            className="space-y-4"
          >
            <FormField
              label={
                editDialog.type === "category"
                  ? t("product_settings.category_name")
                  : t("product_settings.unit_name")
              }
              required
            >
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} autoFocus />
            </FormField>
            {editDialog.type === "unit" && (
              <FormField
                label={t("product_settings.unit_symbol")}
                hint={t("product_settings.unit_symbol_hint")}
              >
                <Input
                  value={formSymbol}
                  onChange={(e) => setFormSymbol(e.target.value)}
                  maxLength={10}
                />
              </FormField>
            )}
            <DialogFooter>
              <Button type="submit" disabled={saving || !formName.trim()}>
                {saving ? t("common.saving") : t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirm({ open: false, type: "category", id: null });
        }}
        title={
          deleteConfirm.type === "category"
            ? t("product_settings.delete_category")
            : t("product_settings.delete_unit")
        }
        description={
          deleteConfirm.type === "category"
            ? t("product_settings.delete_category_confirm")
            : t("product_settings.delete_unit_confirm")
        }
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  );
}
