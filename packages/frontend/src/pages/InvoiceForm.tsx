import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { CurrencyCombobox } from "@/components/shared/CurrencyCombobox";
import { ExchangeRateField } from "@/components/shared/ExchangeRateField";
import { FormField } from "@/components/shared/FormField";
import { PaymentTermsPicker, paymentTermsToDays } from "@/components/shared/PaymentTermsPicker";
import { type SaveStatus, SaveStatusIndicator } from "@/components/shared/SaveStatusIndicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/i18n";
import { isInvoiceFormEditable } from "@/lib/constants";
import { addDaysIso, todayIso } from "@/lib/date";
import { formatApiError } from "@/lib/format-api-error";
import { markRowHighlight } from "@/lib/highlight-row";
import { cn, formatCurrency } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings.store";

interface LineItem {
  _key: string;
  product_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  unit: string;
  tax_id: string;
  tax_rate: number;
  sort_order: number;
}

let nextKey = 1;
function genKey() {
  return `item-${nextKey++}`;
}

function SortableLineItem({
  id,
  item,
  index,
  isFirst,
  products,
  taxDefs,
  errors,
  itemCount,
  onProductSelect,
  onUpdateItem,
  onRemoveItem,
  t,
}: {
  id: string;
  item: LineItem;
  index: number;
  isFirst: boolean;
  products: any[];
  taxDefs: any[];
  errors: Record<string, string>;
  itemCount: number;
  onProductSelect: (index: number, productId: string) => void;
  onUpdateItem: (index: number, field: string, value: any) => void;
  onRemoveItem: (index: number) => void;
  t: (key: string) => string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    position: isDragging ? ("relative" as const) : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className={cn("space-y-1", isDragging && "opacity-50")}>
      <div className="grid grid-cols-[auto_2fr_2fr_1fr_1fr_1.5fr_1.5fr_1fr] gap-2 items-end min-w-[720px] sm:min-w-0">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className={cn(
            "flex items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors",
            isFirst && "mt-5",
          )}
          aria-label={t("a11y.drag_to_reorder")}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div>
          {isFirst && (
            <Label className="text-xs text-muted-foreground">{t("invoices.product")}</Label>
          )}
          <select
            value={item.product_id}
            onChange={(e) => onProductSelect(index, e.target.value)}
            className="form-select"
          >
            <option value="">{t("invoices.manual_entry")}</option>
            {products.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          {isFirst && (
            <Label className="text-xs text-muted-foreground">
              {t("invoices.description")} <span className="text-destructive">*</span>
            </Label>
          )}
          <Input
            value={item.description}
            onChange={(e) => onUpdateItem(index, "description", e.target.value)}
            placeholder={t("invoices.description")}
            aria-invalid={!!errors[`item_${index}_description`]}
          />
        </div>
        <div>
          {isFirst && <Label className="text-xs text-muted-foreground">{t("invoices.qty")}</Label>}
          <NumberInput
            value={item.quantity}
            min={0}
            onValueChange={(v) => onUpdateItem(index, "quantity", v)}
            aria-invalid={!!errors[`item_${index}_quantity`]}
          />
        </div>
        <div>
          {isFirst && <Label className="text-xs text-muted-foreground">{t("invoices.unit")}</Label>}
          <select
            value={item.unit}
            onChange={(e) => onUpdateItem(index, "unit", e.target.value)}
            className="form-select"
          >
            <option value="piece">{t("invoices.unit_piece")}</option>
            <option value="hour">{t("invoices.unit_hour")}</option>
            <option value="day">{t("invoices.unit_day")}</option>
            <option value="kg">{t("invoices.unit_kg")}</option>
            <option value="meter">{t("invoices.unit_meter")}</option>
            <option value="lump_sum">{t("invoices.unit_lump_sum")}</option>
          </select>
        </div>
        <div>
          {isFirst && (
            <Label className="text-xs text-muted-foreground">{t("invoices.unit_price")}</Label>
          )}
          <NumberInput
            value={item.unit_price}
            min={0}
            decimals={2}
            onValueChange={(v) => onUpdateItem(index, "unit_price", v)}
            aria-invalid={!!errors[`item_${index}_unit_price`]}
          />
        </div>
        <div>
          {isFirst && <Label className="text-xs text-muted-foreground">{t("invoices.tax")}</Label>}
          <select
            value={item.tax_id}
            onChange={(e) => onUpdateItem(index, "tax_id", e.target.value)}
            className="form-select"
          >
            <option value="">{t("invoices.no_tax")}</option>
            {taxDefs.map((td: any) => (
              <option key={td.id} value={td.id}>
                {td.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-sm font-medium w-full text-right tabular-nums">
            {formatCurrency(item.quantity * item.unit_price)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("a11y.remove_item")}
            onClick={() => onRemoveItem(index)}
            disabled={itemCount <= 1}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {(errors[`item_${index}_description`] ||
        errors[`item_${index}_quantity`] ||
        errors[`item_${index}_unit_price`]) && (
        <p className="text-xs text-destructive pl-0.5 animate-slide-down">
          {errors[`item_${index}_description`] ||
            errors[`item_${index}_quantity`] ||
            errors[`item_${index}_unit_price`]}
        </p>
      )}
    </div>
  );
}

interface Props {
  onSave: (id: string) => void;
}

export default function InvoiceForm({ onSave }: Props) {
  const { id } = useParams();
  const isEdit = !!id && id !== "new";
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [taxDefs, setTaxDefs] = useState<any[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const [form, setForm] = useState({
    customer_id: "",
    invoice_number: "",
    issue_date: todayIso(),
    due_date: "",
    payment_terms: "",
    notes: "",
    currency: "USD",
    exchange_rate: 1,
    locale: "",
    discount_type: "" as string,
    discount_value: 0,
    prices_include_tax: false,
  });

  const baseCurrency = useSettingsStore(
    (s) => s.settings.base_currency || s.settings.currency || "USD",
  );
  const autoFetchRates = useSettingsStore((s) => s.settings.exchange_rate_auto_fetch === "true");

  const [items, setItems] = useState<LineItem[]>([
    {
      _key: genKey(),
      product_id: "",
      description: "",
      quantity: 1,
      unit_price: 0,
      unit: "piece",
      tax_id: "",
      tax_rate: 0,
      sort_order: 0,
    },
  ]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((prev) => {
        const oldIndex = prev.findIndex((item) => item._key === active.id);
        const newIndex = prev.findIndex((item) => item._key === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const initialLoadRef = useRef(true);

  const validate = useCallback(
    (f: typeof form, itms: LineItem[]): Record<string, string> => {
      const newErrors: Record<string, string> = {};
      if (!f.customer_id) newErrors.customer_id = t("validation.customer_required");
      if (!f.issue_date) newErrors.issue_date = t("validation.issue_date_required");
      if (f.due_date && f.due_date < f.issue_date)
        newErrors.due_date = t("validation.due_date_after_issue");
      itms.forEach((item, i) => {
        if (!item.description.trim())
          newErrors[`item_${i}_description`] = t("validation.description_required");
        if (item.quantity <= 0) newErrors[`item_${i}_quantity`] = t("validation.must_be_positive");
        if (item.unit_price < 0)
          newErrors[`item_${i}_unit_price`] = t("validation.must_be_non_negative");
      });
      return newErrors;
    },
    [t],
  );

  // Eager live validation: surface errors immediately for fields the user has interacted with,
  // and surface every error after first submit attempt.
  useEffect(() => {
    const all = validate(form, items);
    if (hasSubmitted) {
      setErrors(all);
      return;
    }
    const filtered: Record<string, string> = {};
    for (const [key, msg] of Object.entries(all)) {
      if (touched.has(key)) filtered[key] = msg;
    }
    setErrors(filtered);
  }, [form, items, hasSubmitted, touched, validate]);

  const markTouched = useCallback((field: string) => {
    setTouched((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
  }, []);

  useEffect(() => {
    api.listCustomers({ limit: "1000" }).then((r) => setCustomers(r.data.items));
    api.listProducts({ limit: "1000", active: "true" }).then((r) => setProducts(r.data.items));
    api.listTaxDefinitions().then((r) => setTaxDefs(r.data));

    if (!isEdit) {
      api.getSettings().then((r) => {
        setForm((f) => {
          const terms = r.data.default_payment_terms || "";
          // New invoices get a due date derived from the default terms too.
          const days = paymentTermsToDays(terms);
          return {
            ...f,
            payment_terms: terms,
            due_date:
              !f.due_date && days !== null && f.issue_date
                ? addDaysIso(f.issue_date, days)
                : f.due_date,
            notes: r.data.default_notes || "",
            currency: r.data.currency || "USD",
          };
        });
      });
    }

    if (isEdit) {
      initialLoadRef.current = true;
      api.getInvoice(id!).then((r) => {
        const inv = r.data;
        if (!isInvoiceFormEditable(inv.status)) {
          toast.error(t("invoices.invoice_not_editable"));
          navigate(`/invoices/${id}`, { replace: true });
          return;
        }
        setForm({
          customer_id: inv.customer_id,
          invoice_number: inv.invoice_number,
          issue_date: inv.issue_date,
          due_date: inv.due_date || "",
          payment_terms: inv.payment_terms || "",
          notes: inv.notes || "",
          currency: inv.currency,
          exchange_rate: inv.exchange_rate ?? 1,
          locale: inv.locale || "",
          discount_type: inv.discount_type || "",
          discount_value: inv.discount_value || 0,
          prices_include_tax: !!inv.prices_include_tax,
        });
        setItems(
          inv.items.map((it: any) => ({
            _key: genKey(),
            product_id: it.product_id || "",
            description: it.description,
            quantity: it.quantity,
            unit_price: it.unit_price,
            unit: it.unit,
            tax_id: it.tax_id || "",
            tax_rate: it.tax_rate,
            sort_order: it.sort_order,
          })),
        );
        if (inv.updated_at) {
          setLastSavedAt(new Date(inv.updated_at).getTime());
          setSaveStatus("saved");
        }
        // Re-arm autosave after fresh load. Wait one tick so the form/items state updates first.
        setTimeout(() => {
          initialLoadRef.current = false;
        }, 0);
      });
    }
  }, [id, isEdit, navigate, t]);

  // Auto-save (edit mode only) — debounced 1500ms after last change
  useEffect(() => {
    if (!isEdit) return;
    if (initialLoadRef.current) return;
    const validation = validate(form, items);
    if (Object.keys(validation).length > 0) return;
    const timer = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        const data = {
          ...form,
          invoice_number: form.invoice_number,
          locale: form.locale || null,
          discount_type: form.discount_type || null,
          items: items.map(({ _key, ...item }, i) => ({
            ...item,
            sort_order: i,
            product_id: item.product_id || null,
            tax_id: item.tax_id || null,
          })),
        };
        await api.updateInvoice(id!, data);
        setLastSavedAt(Date.now());
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [form, items, isEdit, id, validate]);

  const handleProductSelect = (index: number, productId: string) => {
    const product = products.find((p: any) => p.id === productId);
    if (!product) return;
    const taxDef = taxDefs.find((t: any) => t.id === product.tax_id);
    const newItems = [...items];
    newItems[index] = {
      ...newItems[index],
      product_id: productId,
      description: product.name + (product.description ? ` - ${product.description}` : ""),
      unit_price: product.unit_price,
      unit: product.unit,
      tax_id: product.tax_id || "",
      tax_rate: taxDef?.rate || 0,
    };
    setItems(newItems);
  };

  const updateItem = (index: number, field: string, value: any) => {
    const newItems = [...items];
    (newItems[index] as any)[field] = value;
    if (field === "tax_id") {
      const taxDef = taxDefs.find((t: any) => t.id === value);
      newItems[index].tax_rate = taxDef?.rate || 0;
    }
    setItems(newItems);
    markTouched(`item_${index}_${field}`);
  };

  const addItem = useCallback(() => {
    setItems((prev) => [
      ...prev,
      {
        _key: genKey(),
        product_id: "",
        description: "",
        quantity: 1,
        unit_price: 0,
        unit: "piece",
        tax_id: "",
        tax_rate: 0,
        sort_order: prev.length,
      },
    ]);
  }, []);

  // Keyboard shortcuts: Ctrl/Cmd+S to save, Ctrl/Cmd+Enter to add item
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        addItem();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [addItem]);

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  // Calculate totals
  let subtotal: number;
  let taxTotal: number;
  if (form.prices_include_tax) {
    // Tax-inclusive: unit prices are gross, extract tax
    subtotal = items.reduce((sum, item) => {
      const gross = item.quantity * item.unit_price;
      return sum + gross / (1 + item.tax_rate / 100);
    }, 0);
    taxTotal = items.reduce((sum, item) => {
      const gross = item.quantity * item.unit_price;
      return sum + (gross - gross / (1 + item.tax_rate / 100));
    }, 0);
  } else {
    subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
    taxTotal = items.reduce(
      (sum, item) => sum + (item.quantity * item.unit_price * item.tax_rate) / 100,
      0,
    );
  }
  let discountAmount = 0;
  if (form.discount_type === "percentage") discountAmount = subtotal * (form.discount_value / 100);
  else if (form.discount_type === "amount") discountAmount = form.discount_value;
  const total = subtotal - discountAmount + taxTotal;

  // Currency change resets the rate to 1 for the base currency, and (when
  // auto-fetch is enabled) pulls a live rate for foreign currencies. The guard
  // `f.currency === code` avoids a stale async response clobbering a newer pick.
  const handleCurrencyChange = (code: string) => {
    const isBase = code.toUpperCase() === baseCurrency.toUpperCase();
    setForm((f) => ({ ...f, currency: code, exchange_rate: isBase ? 1 : f.exchange_rate }));
    if (autoFetchRates && !isBase) {
      api
        .getExchangeRate(code, baseCurrency)
        .then((res) => {
          if (res.data.rate != null) {
            setForm((f) =>
              f.currency === code ? { ...f, exchange_rate: res.data.rate as number } : f,
            );
          }
        })
        .catch(() => {
          /* offline — keep manual entry */
        });
    }
  };

  const handleCustomerChange = (customerId: string) => {
    markTouched("customer_id");
    const cust = customers.find((c: any) => c.id === customerId);
    setForm((f) => ({ ...f, customer_id: customerId }));
    if (cust?.currency) handleCurrencyChange(cust.currency);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasSubmitted(true);
    const errs = validate(form, items);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    try {
      const data = {
        ...form,
        // Don't send invoice_number for new invoices — backend generates a draft number
        invoice_number: isEdit ? form.invoice_number : undefined,
        locale: form.locale || null,
        discount_type: form.discount_type || null,
        items: items.map(({ _key, ...item }, i) => ({
          ...item,
          sort_order: i,
          product_id: item.product_id || null,
          tax_id: item.tax_id || null,
        })),
      };
      let result;
      if (isEdit) {
        result = await api.updateInvoice(id!, data);
        setLastSavedAt(Date.now());
        setSaveStatus("saved");
      } else {
        result = await api.createInvoice(data);
        if (result?.data?.id) markRowHighlight("invoice", result.data.id);
      }
      toast.success(isEdit ? t("invoices.invoice_updated") : t("invoices.invoice_created"));
      onSave(result.data.id);
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="max-w-4xl space-y-6" noValidate>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-2">
        <div>
          <Breadcrumbs
            items={[
              { label: t("nav.dashboard"), href: "/" },
              { label: t("nav.invoices"), href: "/invoices" },
              { label: isEdit ? t("invoices.edit_invoice") : t("invoices.new_invoice") },
            ]}
          />
          <div className="flex items-center gap-4 mt-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {isEdit ? t("invoices.edit_invoice") : t("invoices.new_invoice")}
            </h1>
            {isEdit && <SaveStatusIndicator status={saveStatus} lastSavedAt={lastSavedAt} />}
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => navigate(-1)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={loading}
            title={`${loading ? t("common.saving") : isEdit ? t("invoices.update_invoice") : t("invoices.save_as_draft")} (Ctrl+S)`}
          >
            <Save className="h-4 w-4" />
            {loading
              ? t("common.saving")
              : isEdit
                ? t("invoices.update_invoice")
                : t("invoices.save_as_draft")}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Header */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("invoices.invoice_details")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label={t("invoices.customer")} error={errors.customer_id} required>
              <select
                value={form.customer_id}
                onChange={(e) => handleCustomerChange(e.target.value)}
                onBlur={() => markTouched("customer_id")}
                className={cn(
                  "form-select",
                  errors.customer_id && "border-destructive ring-3 ring-destructive/20",
                )}
              >
                <option value="">{t("invoices.select_customer")}</option>
                {customers.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label={t("invoices.invoice_number")}>
              {!isEdit ? (
                <Input
                  value=""
                  placeholder={t("invoices.auto_number_on_send")}
                  disabled
                  className="text-muted-foreground"
                />
              ) : (
                <Input
                  value={form.invoice_number}
                  disabled={form.invoice_number.startsWith("DRAFT-")}
                  onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                  className={
                    form.invoice_number.startsWith("DRAFT-") ? "text-muted-foreground" : ""
                  }
                />
              )}
            </FormField>
            <FormField label={t("invoices.issue_date")} error={errors.issue_date} required>
              <Input
                type="date"
                value={form.issue_date}
                onChange={(e) => {
                  markTouched("issue_date");
                  const issueDate = e.target.value;
                  setForm((f) => {
                    // Keep an auto-derived due date in sync with the issue
                    // date; never touch a manually overridden one.
                    const days = paymentTermsToDays(f.payment_terms);
                    const wasDerived =
                      days !== null &&
                      (!f.due_date ||
                        (!!f.issue_date && f.due_date === addDaysIso(f.issue_date, days)));
                    return {
                      ...f,
                      issue_date: issueDate,
                      due_date:
                        wasDerived && issueDate && days !== null
                          ? addDaysIso(issueDate, days)
                          : f.due_date,
                    };
                  });
                }}
                onBlur={() => markTouched("issue_date")}
                aria-invalid={!!errors.issue_date}
              />
            </FormField>
            <FormField label={t("invoices.due_date")} error={errors.due_date}>
              <Input
                type="date"
                value={form.due_date}
                onChange={(e) => {
                  markTouched("due_date");
                  setForm({ ...form, due_date: e.target.value });
                }}
                onBlur={() => markTouched("due_date")}
                aria-invalid={!!errors.due_date}
              />
            </FormField>
            <FormField label={t("invoices.payment_terms")}>
              <PaymentTermsPicker
                value={form.payment_terms}
                onChange={(value) => {
                  // Picking recognised terms recomputes the due date from the
                  // issue date; the due date stays directly editable after.
                  const days = paymentTermsToDays(value);
                  setForm((f) => ({
                    ...f,
                    payment_terms: value,
                    due_date:
                      days !== null && f.issue_date ? addDaysIso(f.issue_date, days) : f.due_date,
                  }));
                }}
              />
            </FormField>
            <FormField label={t("invoices.currency")}>
              <CurrencyCombobox value={form.currency} onChange={handleCurrencyChange} />
            </FormField>
            <ExchangeRateField
              fromCurrency={form.currency}
              baseCurrency={baseCurrency}
              rate={form.exchange_rate}
              onChange={(rate) => setForm((f) => ({ ...f, exchange_rate: rate }))}
              amount={total}
            />
            <FormField label={t("invoices.locale")} hint={t("invoices.locale_hint")}>
              <select
                value={form.locale}
                onChange={(e) => setForm({ ...form, locale: e.target.value })}
                className="form-select"
              >
                <option value="">{t("common.none")}</option>
                <option value="en-US">en-US</option>
                <option value="en-GB">en-GB</option>
                <option value="de-DE">de-DE</option>
                <option value="fr-FR">fr-FR</option>
                <option value="es-ES">es-ES</option>
                <option value="it-IT">it-IT</option>
                <option value="pt-BR">pt-BR</option>
                <option value="nl-NL">nl-NL</option>
                <option value="tr-TR">tr-TR</option>
                <option value="ja-JP">ja-JP</option>
                <option value="zh-CN">zh-CN</option>
              </select>
            </FormField>
          </CardContent>
        </Card>

        {/* Line Items */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("invoices.line_items")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible">
              <div className="space-y-3">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={items.map((item) => item._key)}
                    strategy={verticalListSortingStrategy}
                  >
                    {items.map((item, i) => (
                      <SortableLineItem
                        key={item._key}
                        id={item._key}
                        item={item}
                        index={i}
                        isFirst={i === 0}
                        products={products}
                        taxDefs={taxDefs}
                        errors={errors}
                        itemCount={items.length}
                        onProductSelect={handleProductSelect}
                        onUpdateItem={updateItem}
                        onRemoveItem={removeItem}
                        t={t}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addItem}
              title={`${t("invoices.add_item")} (Ctrl+Enter)`}
            >
              <Plus className="h-4 w-4 mr-1" /> {t("invoices.add_item")}
            </Button>
          </CardContent>
        </Card>

        {/* Totals & Notes */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("invoices.notes")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={4}
                placeholder={t("invoices.notes_placeholder")}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("common.total")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.prices_include_tax}
                  onChange={(e) => setForm({ ...form, prices_include_tax: e.target.checked })}
                  className="rounded"
                />
                <span className="text-muted-foreground">{t("invoices.prices_include_tax")}</span>
              </label>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("invoices.subtotal")}</span>
                <span className="tabular-nums">{formatCurrency(subtotal, form.currency)}</span>
              </div>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">{t("invoices.discount")}</Label>
                  <select
                    value={form.discount_type}
                    onChange={(e) => setForm({ ...form, discount_type: e.target.value })}
                    className="form-select"
                  >
                    <option value="">{t("common.none")}</option>
                    <option value="percentage">%</option>
                    <option value="amount">{t("common.fixed")}</option>
                  </select>
                </div>
                {form.discount_type && (
                  <div className="flex-1">
                    <NumberInput
                      value={form.discount_value}
                      min={0}
                      decimals={2}
                      onValueChange={(v) => setForm({ ...form, discount_value: v })}
                    />
                  </div>
                )}
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>{t("invoices.discount")}</span>
                  <span className="tabular-nums">
                    -{formatCurrency(discountAmount, form.currency)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("invoices.tax")}</span>
                <span className="tabular-nums">{formatCurrency(taxTotal, form.currency)}</span>
              </div>
              <div className="flex justify-between font-semibold text-lg border-t pt-3">
                <span>{t("common.total")}</span>
                <span className="tabular-nums">{formatCurrency(total, form.currency)}</span>
              </div>
              {form.currency.toUpperCase() !== baseCurrency.toUpperCase() && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t("invoices.in_base_currency", { currency: baseCurrency })}</span>
                  <span className="tabular-nums">
                    ≈ {formatCurrency(total * (form.exchange_rate || 0), baseCurrency)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}
