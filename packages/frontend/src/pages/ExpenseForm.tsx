import { ExternalLink, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { CurrencyCombobox } from "@/components/shared/CurrencyCombobox";
import { ExchangeRateField } from "@/components/shared/ExchangeRateField";
import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { isPositive, maxLength, required, useFormValidation } from "@/hooks/use-form-validation";
import { useTranslation } from "@/i18n";
import { toLocalIsoDate } from "@/lib/date";
import { formatApiError } from "@/lib/format-api-error";
import { markRowHighlight } from "@/lib/highlight-row";
import { useSettingsStore } from "@/stores/settings.store";

interface Props {
  onSave: () => void;
}

const DEFAULT_CATEGORIES = [
  "Office",
  "Travel",
  "Meals",
  "Software",
  "Equipment",
  "Marketing",
  "Utilities",
  "Rent",
  "Professional Services",
  "Other",
];

export default function ExpenseForm({ onSave }: Props) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const defaultCurrency = useSettingsStore((s) => s.settings.currency) || "USD";
  const baseCurrency = useSettingsStore(
    (s) => s.settings.base_currency || s.settings.currency || "USD",
  );
  const autoFetchRates = useSettingsStore((s) => s.settings.exchange_rate_auto_fetch === "true");
  const isEdit = !!id && id !== "new";
  const [loading, setLoading] = useState(false);
  const [rebilling, setRebilling] = useState(false);
  const [taxDefs, setTaxDefs] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [billedInvoiceId, setBilledInvoiceId] = useState<string | null>(null);
  const [form, setForm] = useState({
    vendor: "",
    category: "",
    description: "",
    expense_date: toLocalIsoDate(new Date()),
    amount: 0,
    tax_id: "",
    currency: defaultCurrency,
    exchange_rate: 1,
    receipt_reference: "",
    customer_id: "",
    is_billable: 0,
    notes: "",
  });

  const { validateAll, onBlur, onChange, getError } = useFormValidation({
    vendor: [
      maxLength(t("validation.max_length", { field: t("expenses.vendor"), max: "255" }), 255),
    ],
    expense_date: [required(t("validation.required", { field: t("expenses.date") }))],
    amount: [isPositive(t("validation.must_be_positive_field", { field: t("expenses.amount") }))],
  });

  useEffect(() => {
    api.listTaxDefinitions().then((r) => setTaxDefs(r.data));
    api.listCustomers({ limit: "100" }).then((r) => setCustomers(r.data.items ?? []));
    if (isEdit) {
      api.getExpense(id).then((r) => {
        const d = r.data;
        setBilledInvoiceId(d.billed_invoice_id || null);
        setForm({
          vendor: d.vendor || "",
          category: d.category || "",
          description: d.description || "",
          expense_date: d.expense_date || toLocalIsoDate(new Date()),
          amount: d.amount ?? 0,
          tax_id: d.tax_id || "",
          currency: d.currency || defaultCurrency,
          exchange_rate: d.exchange_rate ?? 1,
          receipt_reference: d.receipt_reference || "",
          customer_id: d.customer_id || "",
          is_billable: d.is_billable ?? 0,
          notes: d.notes || "",
        });
      });
    }
    // defaultCurrency intentionally only seeds the initial new-expense form.
    // biome-ignore lint/correctness/useExhaustiveDependencies: seed-once on mount/id
  }, [id, isEdit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateAll(form)) return;
    setLoading(true);
    try {
      const data = {
        ...form,
        tax_id: form.tax_id || null,
        customer_id: form.customer_id || null,
      };
      if (isEdit) {
        await api.updateExpense(id, data);
        toast.success(t("expenses.expense_updated"));
      } else {
        const res = await api.createExpense(data);
        if (res?.data?.id) markRowHighlight("expense", res.data.id);
        toast.success(t("expenses.expense_created"));
      }
      onSave();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleRebill = async () => {
    if (!id) return;
    setRebilling(true);
    try {
      const res = await api.rebillExpense(id);
      toast.success(t("expenses.rebill_success"));
      navigate(`/invoices/${res.data.invoice_id}`);
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setRebilling(false);
    }
  };

  const setField = (field: string, value: any) => {
    const newForm = { ...form, [field]: value };
    setForm(newForm);
    onChange(field as any, newForm as any);
  };

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

  const canRebill = isEdit && !!form.is_billable && !!form.customer_id && !billedInvoiceId;

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6" noValidate>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-2">
        <div>
          <Breadcrumbs
            items={[
              { label: t("nav.dashboard"), href: "/" },
              { label: t("nav.expenses"), href: "/expenses" },
              {
                label: isEdit
                  ? form.vendor || t("expenses.edit_expense")
                  : t("expenses.new_expense"),
              },
            ]}
          />
          <h1 className="text-2xl font-semibold tracking-tight mt-2">
            {isEdit ? t("expenses.edit_expense") : t("expenses.new_expense")}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => navigate("/expenses")}>
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
          <CardTitle className="text-sm">{t("expenses.expense_info")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField label={t("expenses.vendor")} error={getError("vendor")}>
              <Input
                value={form.vendor}
                onChange={(e) => setField("vendor", e.target.value)}
                onBlur={() => onBlur("vendor", form)}
                aria-invalid={!!getError("vendor")}
              />
            </FormField>
            <FormField label={t("expenses.date")} error={getError("expense_date")} required>
              <Input
                type="date"
                value={form.expense_date}
                onChange={(e) => setField("expense_date", e.target.value)}
                onBlur={() => onBlur("expense_date", form)}
                aria-invalid={!!getError("expense_date")}
              />
            </FormField>
          </div>

          <FormField label={t("expenses.description")}>
            <Textarea
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              rows={2}
            />
          </FormField>

          <FormField label={t("expenses.category")}>
            <Input
              list="expense-category-options"
              value={form.category}
              onChange={(e) => setField("category", e.target.value)}
              placeholder={t("expenses.category_placeholder")}
            />
            <datalist id="expense-category-options">
              {DEFAULT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat} />
              ))}
            </datalist>
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("expenses.amount_info")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <FormField label={t("expenses.amount")} error={getError("amount")} required>
              <NumberInput
                value={form.amount}
                min={0}
                decimals={2}
                onValueChange={(v) => {
                  const newForm = { ...form, amount: v };
                  setForm(newForm);
                  onChange("amount" as any, newForm as any);
                  onBlur("amount", newForm);
                }}
                aria-invalid={!!getError("amount")}
              />
            </FormField>
            <FormField label={t("expenses.tax")}>
              <select
                value={form.tax_id}
                onChange={(e) => setField("tax_id", e.target.value)}
                className="form-select"
              >
                <option value="">{t("expenses.no_tax")}</option>
                {taxDefs.map((td: any) => (
                  <option key={td.id} value={td.id}>
                    {td.name} ({td.rate}%)
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label={t("invoices.currency")}>
              <CurrencyCombobox value={form.currency} onChange={handleCurrencyChange} />
            </FormField>
          </div>

          <ExchangeRateField
            fromCurrency={form.currency}
            baseCurrency={baseCurrency}
            rate={form.exchange_rate}
            onChange={(rate) => setForm((f) => ({ ...f, exchange_rate: rate }))}
            amount={form.amount}
          />

          <FormField label={t("expenses.receipt_reference")}>
            <Input
              value={form.receipt_reference}
              onChange={(e) => setField("receipt_reference", e.target.value)}
              placeholder={t("expenses.receipt_placeholder")}
            />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("expenses.billing")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label={t("expenses.customer")}>
            <select
              value={form.customer_id}
              onChange={(e) => setField("customer_id", e.target.value)}
              className="form-select"
            >
              <option value="">{t("expenses.no_customer")}</option>
              {customers.map((cust: any) => (
                <option key={cust.id} value={cust.id}>
                  {cust.name}
                </option>
              ))}
            </select>
          </FormField>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_billable"
              checked={!!form.is_billable}
              onChange={(e) => setField("is_billable", e.target.checked ? 1 : 0)}
              className="rounded"
            />
            <Label htmlFor="is_billable" className="text-sm font-normal">
              {t("expenses.is_billable")}
            </Label>
          </div>

          {billedInvoiceId && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate(`/invoices/${billedInvoiceId}`)}
            >
              <ExternalLink className="h-4 w-4 mr-2" /> {t("expenses.view_invoice")}
            </Button>
          )}
          {canRebill && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={rebilling}
              onClick={handleRebill}
            >
              {rebilling ? t("common.saving") : t("expenses.rebill")}
            </Button>
          )}

          <FormField label={t("expenses.notes")}>
            <Textarea
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
              rows={2}
            />
          </FormField>
        </CardContent>
      </Card>
    </form>
  );
}
