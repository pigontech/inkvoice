import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { isPositive, maxLength, required, useFormValidation } from "@/hooks/use-form-validation";
import { useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";
import { markRowHighlight } from "@/lib/highlight-row";
import { pushRecentlyViewed } from "@/lib/recently-viewed";

interface Props {
  onSave: () => void;
}

export default function ProductForm({ onSave }: Props) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isEdit = !!id && id !== "new";
  const [loading, setLoading] = useState(false);
  const [taxDefs, setTaxDefs] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: "",
    description: "",
    sku: "",
    unit_price: 0,
    unit: "piece",
    category: "service",
    tax_id: "",
    is_active: 1,
  });

  const { validateAll, onBlur, onChange, getError } = useFormValidation({
    name: [
      required(t("validation.required", { field: t("products.name") })),
      maxLength(t("validation.max_length", { field: t("products.name"), max: "255" }), 255),
    ],
    description: [
      maxLength(
        t("validation.max_length", { field: t("products.description"), max: "1000" }),
        1000,
      ),
    ],
    sku: [maxLength(t("validation.max_length", { field: t("products.sku"), max: "50" }), 50)],
    unit_price: [
      isPositive(t("validation.must_be_positive_field", { field: t("products.unit_price") })),
    ],
  });

  useEffect(() => {
    api.listTaxDefinitions().then((r) => setTaxDefs(r.data));
    api.listProductCategories().then((r) => setCategories(r.data));
    api.listProductUnits().then((r) => setUnits(r.data));
    if (isEdit) {
      api.getProduct(id).then((r) => {
        const d = r.data;
        setForm({
          name: d.name || "",
          description: d.description || "",
          sku: d.sku || "",
          unit_price: d.unit_price ?? 0,
          unit: d.unit || "piece",
          category: d.category || "service",
          tax_id: d.tax_id || "",
          is_active: d.is_active ?? 1,
        });
        if (d.name) {
          pushRecentlyViewed({
            type: "product",
            id: id!,
            label: d.name,
            sublabel: d.sku ?? undefined,
          });
        }
      });
    }
  }, [id, isEdit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateAll(form)) return;
    setLoading(true);
    try {
      const data = { ...form, tax_id: form.tax_id || null };
      if (isEdit) {
        await api.updateProduct(id, data);
        toast.success(t("products.product_updated"));
      } else {
        const res = await api.createProduct(data);
        if (res?.data?.id) markRowHighlight("product", res.data.id);
        toast.success(t("products.product_created"));
      }
      onSave();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setLoading(false);
    }
  };

  const setField = (field: string, value: any) => {
    const newForm = { ...form, [field]: value };
    setForm(newForm);
    onChange(field as any, newForm as any);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6" noValidate>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-2">
        <div>
          <Breadcrumbs
            items={[
              { label: t("nav.dashboard"), href: "/" },
              { label: t("nav.products"), href: "/products/all" },
              {
                label: isEdit ? form.name || t("products.edit_product") : t("products.new_product"),
              },
            ]}
          />
          <h1 className="text-2xl font-semibold tracking-tight mt-2">
            {isEdit ? t("products.edit_product") : t("products.new_product")}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigate("/products/all")}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={loading}>
            <Save className="h-4 w-4" />
            {loading ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("products.product_info")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label={t("products.name")} error={getError("name")} required>
            <Input
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              onBlur={() => onBlur("name", form)}
              aria-invalid={!!getError("name")}
            />
          </FormField>

          <FormField label={t("products.description")} error={getError("description")}>
            <Textarea
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              onBlur={() => onBlur("description", form)}
              aria-invalid={!!getError("description")}
              rows={2}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label={t("products.sku")} error={getError("sku")}>
              <Input
                value={form.sku}
                onChange={(e) => setField("sku", e.target.value)}
                onBlur={() => onBlur("sku", form)}
                aria-invalid={!!getError("sku")}
              />
            </FormField>
            <FormField label={t("products.unit_price")} error={getError("unit_price")} required>
              <NumberInput
                value={form.unit_price}
                min={0}
                decimals={2}
                onValueChange={(v) => {
                  const newForm = { ...form, unit_price: v };
                  setForm(newForm);
                  onChange("unit_price" as any, newForm as any);
                  onBlur("unit_price", newForm);
                }}
                aria-invalid={!!getError("unit_price")}
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("products.category")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <FormField label={t("products.unit")}>
              <select
                value={form.unit}
                onChange={(e) => setField("unit", e.target.value)}
                className="form-select"
              >
                {units.map((u: any) => (
                  <option key={u.id} value={u.name}>
                    {u.symbol ? `${u.name} (${u.symbol})` : u.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label={t("products.category")}>
              <select
                value={form.category}
                onChange={(e) => setField("category", e.target.value)}
                className="form-select"
              >
                {categories.map((cat: any) => (
                  <option key={cat.id} value={cat.name}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label={t("products.default_tax")}>
              <select
                value={form.tax_id}
                onChange={(e) => setField("tax_id", e.target.value)}
                className="form-select"
              >
                <option value="">{t("products.no_default_tax")}</option>
                {taxDefs.map((td: any) => (
                  <option key={td.id} value={td.id}>
                    {td.name} ({td.rate}%)
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_active"
              checked={!!form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked ? 1 : 0 })}
              className="rounded"
            />
            <Label htmlFor="is_active" className="text-sm font-normal">
              {t("common.active")}
            </Label>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
