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
import { FormField } from "@/components/shared/FormField";
import { type SaveStatus, SaveStatusIndicator } from "@/components/shared/SaveStatusIndicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/i18n";
import { todayIso } from "@/lib/date";
import { formatApiError } from "@/lib/format-api-error";
import { markRowHighlight } from "@/lib/highlight-row";
import { cn, formatCurrency } from "@/lib/utils";

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
  return `qitem-${nextKey++}`;
}

function SortableQuoteItem({
  id,
  item,
  index,
  products,
  taxes,
  itemCount,
  onUpdateItem,
  onRemoveItem,
  t,
}: {
  id: string;
  item: LineItem;
  index: number;
  products: any[];
  taxes: any[];
  itemCount: number;
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
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "grid grid-cols-[auto_3fr_3fr_1fr_2fr_2fr_1fr] gap-2 items-end min-w-[720px] sm:min-w-0",
        isDragging && "opacity-50",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="flex items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors"
        aria-label={t("a11y.drag_to_reorder")}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div>
        <select
          value={item.product_id}
          onChange={(e) => onUpdateItem(index, "product_id", e.target.value)}
          className="form-select text-sm"
        >
          <option value="">{t("quotes.custom_item")}</option>
          {products.map((p: any) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Input
          placeholder={t("quotes.description")}
          value={item.description}
          onChange={(e) => onUpdateItem(index, "description", e.target.value)}
          className="text-sm"
        />
      </div>
      <div>
        <NumberInput
          value={item.quantity}
          min={0}
          onValueChange={(v) => onUpdateItem(index, "quantity", v)}
          className="text-sm"
        />
      </div>
      <div>
        <NumberInput
          value={item.unit_price}
          min={0}
          decimals={2}
          onValueChange={(v) => onUpdateItem(index, "unit_price", v)}
          className="text-sm"
        />
      </div>
      <div>
        <select
          value={item.tax_id}
          onChange={(e) => onUpdateItem(index, "tax_id", e.target.value)}
          className="form-select text-sm"
        >
          <option value="">{t("quotes.no_tax")}</option>
          {taxes.map((td: any) => (
            <option key={td.id} value={td.id}>
              {td.name} ({td.rate}%)
            </option>
          ))}
        </select>
      </div>
      <div>
        <Button
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
  );
}

export default function QuoteForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;
  const { t } = useTranslation();

  const [customers, setCustomers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [taxes, setTaxes] = useState<any[]>([]);

  const [customerId, setCustomerId] = useState("");
  const [issueDate, setIssueDate] = useState(todayIso());
  const [validUntil, setValidUntil] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [locale, setLocale] = useState("");
  const [notes, setNotes] = useState("");
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
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const initialLoadRef = useRef(true);

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

  useEffect(() => {
    api.listCustomers({ limit: "200" }).then((r) => setCustomers(r.data.items));
    api.listProducts({ limit: "200", active: "true" }).then((r) => setProducts(r.data.items));
    api.listTaxDefinitions().then((r) => setTaxes(r.data));
  }, []);

  const fetchQuote = useCallback(async () => {
    if (!id) return;
    initialLoadRef.current = true;
    const res = await api.getQuote(id);
    const q = res.data;
    setCustomerId(q.customer_id);
    setIssueDate(q.issue_date);
    setValidUntil(q.valid_until || "");
    setCurrency(q.currency);
    setLocale(q.locale || "");
    setNotes(q.notes || "");
    setItems(
      q.items.map((it: any) => ({
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
    if (q.updated_at) {
      setLastSavedAt(new Date(q.updated_at).getTime());
      setSaveStatus("saved");
    }
    setTimeout(() => {
      initialLoadRef.current = false;
    }, 0);
  }, [id]);

  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  // Auto-save (edit mode only)
  useEffect(() => {
    if (!isEdit || initialLoadRef.current) return;
    if (!customerId || items.some((it) => !it.description.trim())) return;
    const timer = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        const data = {
          customer_id: customerId,
          issue_date: issueDate,
          valid_until: validUntil || null,
          currency,
          locale: locale || null,
          notes: notes || null,
          items: items.map(({ _key, ...it }, i) => ({ ...it, sort_order: i })),
        };
        await api.updateQuote(id!, data);
        setLastSavedAt(Date.now());
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [isEdit, id, customerId, issueDate, validUntil, currency, locale, notes, items]);

  const updateItem = (index: number, field: string, value: any) => {
    const next = [...items];
    (next[index] as any)[field] = value;

    if (field === "product_id" && value) {
      const p = products.find((p: any) => p.id === value);
      if (p) {
        next[index].description = p.name;
        next[index].unit_price = p.unit_price;
        next[index].unit = p.unit;
        if (p.tax_id) {
          next[index].tax_id = p.tax_id;
          const tax = taxes.find((t: any) => t.id === p.tax_id);
          if (tax) next[index].tax_rate = tax.rate;
        }
      }
    }
    if (field === "tax_id") {
      const tax = taxes.find((t: any) => t.id === value);
      next[index].tax_rate = tax?.rate || 0;
    }
    setItems(next);
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

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!customerId) {
      toast.error(t("validation.select_customer_error"));
      return;
    }
    if (items.some((it) => !it.description)) {
      toast.error(t("validation.items_need_description"));
      return;
    }
    setLoading(true);
    try {
      const data = {
        customer_id: customerId,
        issue_date: issueDate,
        valid_until: validUntil || null,
        currency,
        locale: locale || null,
        notes: notes || null,
        items: items.map(({ _key, ...it }, i) => ({ ...it, sort_order: i })),
      };

      if (isEdit) {
        await api.updateQuote(id!, data);
        toast.success(t("quotes.quote_updated"));
        navigate(`/quotes/${id}`);
      } else {
        const res = await api.createQuote(data);
        if (res?.data?.id) markRowHighlight("quote", res.data.id);
        toast.success(t("quotes.quote_created"));
        navigate(`/quotes/${res.data.id}`);
      }
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setLoading(false);
    }
  };

  // Keyboard shortcuts: Ctrl/Cmd+S to save, Ctrl/Cmd+Enter to add item
  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSubmitRef.current();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        addItem();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [addItem]);

  const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <Breadcrumbs
            items={[
              { label: t("nav.dashboard"), href: "/" },
              { label: t("nav.quotes"), href: "/quotes/all" },
              { label: isEdit ? t("quotes.edit_quote") : t("quotes.new_quote") },
            ]}
          />
          <div className="flex items-center gap-4 mt-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {isEdit ? t("quotes.edit_quote") : t("quotes.new_quote")}
            </h1>
            {isEdit && <SaveStatusIndicator status={saveStatus} lastSavedAt={lastSavedAt} />}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/quotes/all")}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={loading}
            title={`${loading ? t("common.saving") : isEdit ? t("quotes.update_quote") : t("quotes.create_quote")} (Ctrl+S)`}
          >
            <Save className="h-4 w-4" />{" "}
            {loading
              ? t("common.saving")
              : isEdit
                ? t("quotes.update_quote")
                : t("quotes.create_quote")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("quotes.quote_details")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label={t("quotes.customer")}>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="form-select"
            >
              <option value="">{t("quotes.select_customer")}</option>
              {customers.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <FormField label={t("quotes.issue_date")}>
              <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </FormField>
            <FormField label={t("quotes.valid_until")}>
              <Input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </FormField>
            <FormField label={t("invoices.currency")}>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} />
            </FormField>
            <FormField label={t("invoices.locale")} hint={t("invoices.locale_hint")}>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("quotes.line_items")}</CardTitle>
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
                    <SortableQuoteItem
                      key={item._key}
                      id={item._key}
                      item={item}
                      index={i}
                      products={products}
                      taxes={taxes}
                      itemCount={items.length}
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
            variant="outline"
            size="sm"
            onClick={addItem}
            title={`${t("quotes.add_item")} (Ctrl+Enter)`}
          >
            <Plus className="h-4 w-4 mr-1" /> {t("quotes.add_item")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <FormField label={t("quotes.notes")}>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </FormField>
          <div className="mt-4 text-right text-lg font-semibold">
            {t("quotes.subtotal")}: {formatCurrency(subtotal, currency)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
