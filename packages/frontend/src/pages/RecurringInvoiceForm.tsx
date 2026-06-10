import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { useTranslation } from "@/i18n";
import { todayIso } from "@/lib/date";
import { formatApiError } from "@/lib/format-api-error";

export default function RecurringInvoiceForm() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const [customers, setCustomers] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [templateInvoiceId, setTemplateInvoiceId] = useState("");
  const [frequency, setFrequency] = useState("monthly");
  const [intervalValue, setIntervalValue] = useState(1);
  const [nextRunDate, setNextRunDate] = useState(todayIso());
  const [endDate, setEndDate] = useState("");
  const [autoSend, setAutoSend] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.listCustomers({ limit: "200" }).then((r) => setCustomers(r.data.items));
    api.listInvoices({ limit: "200" }).then((r) => setInvoices(r.data.items));
  }, []);

  useEffect(() => {
    if (!id) return;
    api
      .getRecurring(id)
      .then((r) => {
        const s = r.data;
        setCustomerId(s.customer_id);
        setTemplateInvoiceId(s.template_invoice_id);
        setFrequency(s.frequency);
        setIntervalValue(s.interval_value || 1);
        setNextRunDate(s.next_run_date);
        setEndDate(s.end_date || "");
        setAutoSend(!!s.auto_send);
      })
      .catch((err: unknown) => {
        toast.error(formatApiError(err, t));
        navigate("/recurring/all", { replace: true });
      });
  }, [id, navigate, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) {
      toast.error(t("recurring.select_customer_error"));
      return;
    }
    if (!templateInvoiceId) {
      toast.error(t("recurring.select_invoice_error"));
      return;
    }
    setLoading(true);
    try {
      const payload = {
        customer_id: customerId,
        template_invoice_id: templateInvoiceId,
        frequency,
        interval_value: intervalValue,
        next_run_date: nextRunDate,
        end_date: endDate || null,
        auto_send: autoSend,
      };
      if (isEdit) {
        await api.updateRecurring(id!, payload);
        toast.success(t("recurring.schedule_updated"));
      } else {
        await api.createRecurring(payload);
        toast.success(t("recurring.schedule_created"));
      }
      navigate("/recurring/all");
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label={t("common.back")}
            onClick={() => navigate("/recurring/all")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isEdit ? t("recurring.edit_schedule") : t("recurring.new_schedule")}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => navigate("/recurring/all")}
          >
            {t("common.cancel")}
          </Button>
          <Button size="sm" type="submit" disabled={loading}>
            {loading
              ? isEdit
                ? t("common.saving")
                : t("recurring.creating")
              : isEdit
                ? t("common.save")
                : t("recurring.create_schedule")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("recurring.schedule_details")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField label={t("recurring.customer")}>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="form-select"
            >
              <option value="">{t("recurring.select_customer")}</option>
              {customers.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            label={t("recurring.template_invoice")}
            hint={t("recurring.template_invoice_hint")}
          >
            <select
              value={templateInvoiceId}
              onChange={(e) => setTemplateInvoiceId(e.target.value)}
              className="form-select"
            >
              <option value="">{t("recurring.select_invoice")}</option>
              {invoices.map((inv: any) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoice_number} — {inv.customer_name}
                </option>
              ))}
            </select>
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label={t("recurring.frequency")}>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="form-select"
              >
                <option value="daily">{t("recurring.freq_daily")}</option>
                <option value="weekly">{t("recurring.freq_weekly")}</option>
                <option value="monthly">{t("recurring.freq_monthly")}</option>
                <option value="yearly">{t("recurring.freq_yearly")}</option>
              </select>
            </FormField>
            <FormField label={t("recurring.every_n_periods")}>
              <NumberInput value={intervalValue} min={1} integer onValueChange={setIntervalValue} />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FormField label={t("recurring.start_date")}>
              <Input
                type="date"
                value={nextRunDate}
                onChange={(e) => setNextRunDate(e.target.value)}
              />
            </FormField>
            <FormField label={t("recurring.end_date")} hint={t("common.optional")}>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </FormField>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoSend}
              onChange={(e) => setAutoSend(e.target.checked)}
              className="rounded"
            />
            {t("recurring.auto_send")}
          </label>
        </CardContent>
      </Card>
    </form>
  );
}
