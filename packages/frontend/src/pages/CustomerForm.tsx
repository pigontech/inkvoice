import { Clock, Copy, DollarSign, FileText, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { FormField } from "@/components/shared/FormField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { isEmail, maxLength, required, useFormValidation } from "@/hooks/use-form-validation";
import { useTranslation } from "@/i18n";
import { STATUS_COLORS } from "@/lib/constants";
import { COUNTRIES } from "@/lib/countries";
import { formatApiError } from "@/lib/format-api-error";
import { markRowHighlight } from "@/lib/highlight-row";
import { pushRecentlyViewed } from "@/lib/recently-viewed";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Props {
  onSave: () => void;
}

export default function CustomerForm({ onSave }: Props) {
  const { t, language } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id && id !== "new";
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{
    invoice_count: number;
    total_revenue: number;
    last_invoice_date: string | null;
  } | null>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [portal, setPortal] = useState<{ enabled: boolean; token: string | null }>({
    enabled: false,
    token: null,
  });
  const [portalBusy, setPortalBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    postal_code: "",
    country: "",
    tax_id: "",
    notes: "",
    language: "",
    default_template_id: "",
    currency: "",
  });

  const { validateAll, onBlur, onChange, getError } = useFormValidation({
    name: [
      required(t("validation.required", { field: t("customers.name") })),
      maxLength(t("validation.max_length", { field: t("customers.name"), max: "255" }), 255),
    ],
    email: [isEmail(t("validation.invalid_email", { field: t("customers.email") }))],
    phone: [maxLength(t("validation.max_length", { field: t("customers.phone"), max: "50" }), 50)],
    country: [],
    notes: [
      maxLength(t("validation.max_length", { field: t("invoices.notes"), max: "2000" }), 2000),
    ],
  });

  useEffect(() => {
    api.listTemplates().then((r) => setTemplates(r.data));
  }, []);

  useEffect(() => {
    if (isEdit) {
      api.getCustomer(id).then((r) => {
        const d = r.data;
        setForm({
          name: d.name || "",
          email: d.email || "",
          phone: d.phone || "",
          address_line1: d.address_line1 || "",
          address_line2: d.address_line2 || "",
          city: d.city || "",
          state: d.state || "",
          postal_code: d.postal_code || "",
          country: d.country || "",
          tax_id: d.tax_id || "",
          notes: d.notes || "",
          language: d.language || "",
          default_template_id: d.default_template_id || "",
          currency: d.currency || "",
        });
        setStats({
          invoice_count: d.invoice_count,
          total_revenue: d.total_revenue,
          last_invoice_date: d.last_invoice_date,
        });
        setPortal({ enabled: !!d.portal_enabled, token: d.portal_token ?? null });
        if (d.name) {
          pushRecentlyViewed({
            type: "customer",
            id: id!,
            label: d.name,
            sublabel: d.email ?? undefined,
          });
        }
      });
      api.listInvoices({ customer_id: id, limit: "50" }).then((r) => {
        setInvoices(r.data.items);
      });
    }
  }, [id, isEdit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateAll(form)) return;
    setLoading(true);
    try {
      if (isEdit) {
        await api.updateCustomer(id, form);
        toast.success(t("customers.customer_updated"));
      } else {
        const res = await api.createCustomer(form);
        if (res?.data?.id) markRowHighlight("customer", res.data.id);
        toast.success(t("customers.customer_created"));
      }
      onSave();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setLoading(false);
    }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newForm = { ...form, [field]: e.target.value };
    setForm(newForm);
    onChange(field as any, newForm as any);
  };

  const outstanding = invoices
    .filter((inv: any) => inv.status === "sent" || inv.status === "overdue")
    .reduce((sum: number, inv: any) => sum + inv.total, 0);

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-2">
        <div>
          <Breadcrumbs
            items={[
              { label: t("nav.dashboard"), href: "/" },
              { label: t("nav.customers"), href: "/customers" },
              {
                label: isEdit
                  ? form.name || t("customers.edit_customer")
                  : t("customers.new_customer"),
              },
            ]}
          />
          <h1 className="text-2xl font-semibold tracking-tight mt-2">
            {isEdit ? t("customers.edit_customer") : t("customers.new_customer")}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => navigate("/customers")}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={loading}>
            <Save className="h-4 w-4" />
            {loading ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </div>

      <div
        className={
          isEdit ? "grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6 items-start" : "max-w-2xl"
        }
      >
        {/* Left: form fields */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("customers.contact_info")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField label={t("customers.name")} error={getError("name")} required>
                <Input
                  value={form.name}
                  onChange={set("name")}
                  onBlur={() => onBlur("name", form)}
                  aria-invalid={!!getError("name")}
                />
              </FormField>

              <div className="grid grid-cols-2 gap-4">
                <FormField label={t("customers.email")} error={getError("email")}>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={set("email")}
                    onBlur={() => onBlur("email", form)}
                    aria-invalid={!!getError("email")}
                  />
                </FormField>
                <FormField label={t("customers.phone")} error={getError("phone")}>
                  <Input
                    value={form.phone}
                    onChange={set("phone")}
                    onBlur={() => onBlur("phone", form)}
                    aria-invalid={!!getError("phone")}
                  />
                </FormField>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("customers.address")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField label={t("customers.address_line1")}>
                <Input value={form.address_line1} onChange={set("address_line1")} />
              </FormField>
              <FormField label={t("customers.address_line2")}>
                <Input value={form.address_line2} onChange={set("address_line2")} />
              </FormField>

              <div className="grid grid-cols-3 gap-4">
                <FormField label={t("customers.city")}>
                  <Input value={form.city} onChange={set("city")} />
                </FormField>
                <FormField label={t("customers.state")}>
                  <Input value={form.state} onChange={set("state")} />
                </FormField>
                <FormField label={t("customers.postal_code")}>
                  <Input value={form.postal_code} onChange={set("postal_code")} />
                </FormField>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField label={t("customers.country")} error={getError("country")}>
                  <select
                    value={form.country}
                    onChange={(e) => {
                      const newForm = { ...form, country: e.target.value };
                      setForm(newForm);
                      onChange("country" as any, newForm as any);
                    }}
                    className="form-select"
                  >
                    <option value="">{t("customers.select_country")}</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c[language] || c.en}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label={t("customers.tax_id")}>
                  <Input value={form.tax_id} onChange={set("tax_id")} />
                </FormField>
              </div>

              <FormField label={t("customers.language")} hint={t("customers.language_hint")}>
                <select
                  value={form.language}
                  onChange={(e) => setForm({ ...form, language: e.target.value })}
                  className="form-select"
                >
                  <option value="">{t("customers.language_default")}</option>
                  <option value="en-US">English (US)</option>
                  <option value="en-GB">English (UK)</option>
                  <option value="tr-TR">Türkçe</option>
                  <option value="de-DE">Deutsch</option>
                  <option value="fr-FR">Français</option>
                  <option value="es-ES">Español</option>
                  <option value="it-IT">Italiano</option>
                  <option value="pt-PT">Português</option>
                  <option value="nl-NL">Nederlands</option>
                </select>
              </FormField>

              <FormField
                label={t("customers.default_currency")}
                hint={t("customers.default_currency_hint")}
              >
                <select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="form-select"
                >
                  <option value="">{t("customers.default_currency_inherit")}</option>
                  {["USD", "EUR", "GBP", "TRY", "JPY", "CAD", "AUD", "CHF"].map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField
                label={t("customers.default_template")}
                hint={t("customers.default_template_hint")}
              >
                <select
                  value={form.default_template_id}
                  onChange={(e) => setForm({ ...form, default_template_id: e.target.value })}
                  className="form-select"
                >
                  <option value="">{t("customers.default_template_inherit")}</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("customers.additional")}</CardTitle>
            </CardHeader>
            <CardContent>
              <FormField label={t("invoices.notes")} error={getError("notes")}>
                <Textarea
                  value={form.notes}
                  onChange={set("notes")}
                  onBlur={() => onBlur("notes", form)}
                  aria-invalid={!!getError("notes")}
                  rows={3}
                  placeholder={t("customers.notes_placeholder")}
                />
              </FormField>
            </CardContent>
          </Card>

          {isEdit && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("customers.portal_access")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{t("customers.portal_access_hint")}</p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={portal.enabled ? "outline" : "default"}
                    disabled={portalBusy}
                    onClick={async () => {
                      setPortalBusy(true);
                      try {
                        if (portal.enabled) {
                          await api.disableCustomerPortal(id!);
                          setPortal({ enabled: false, token: null });
                          toast.success(t("customers.portal_disabled"));
                        } else {
                          const res = await api.enableCustomerPortal(id!);
                          setPortal({ enabled: true, token: res.data.token });
                          if (res.data.email_status === "sent") {
                            toast.success(t("customers.portal_enabled_with_email"));
                          } else {
                            toast.success(t("customers.portal_enabled"));
                          }
                        }
                      } catch (err) {
                        toast.error(formatApiError(err, t));
                      } finally {
                        setPortalBusy(false);
                      }
                    }}
                  >
                    {portal.enabled ? t("customers.disable_portal") : t("customers.enable_portal")}
                  </Button>
                  {portal.enabled && (
                    <Badge variant="secondary">{t("customers.portal_active")}</Badge>
                  )}
                </div>
                {portal.enabled && portal.token && (
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={`${window.location.origin}/portal/${portal.token}`}
                      onFocus={(e) => e.currentTarget.select()}
                      className="font-mono text-xs"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const url = `${window.location.origin}/portal/${portal.token}`;
                        navigator.clipboard.writeText(url);
                        toast.success(t("invoices.link_copied"));
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Stats + Invoices (edit mode only) */}
        {isEdit && stats && (
          <div className="space-y-6">
            {/* Stat Cards */}
            <div className="grid grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <DollarSign className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium uppercase tracking-wide">
                      {t("dashboard.revenue")}
                    </span>
                  </div>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatCurrency(stats.total_revenue)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium uppercase tracking-wide">
                      {t("dashboard.outstanding")}
                    </span>
                  </div>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatCurrency(outstanding)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <FileText className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium uppercase tracking-wide">
                      {t("nav.invoices")}
                    </span>
                  </div>
                  <p className="text-lg font-semibold tabular-nums">{stats.invoice_count}</p>
                </CardContent>
              </Card>
            </div>

            {/* Invoices Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("nav.invoices")}</CardTitle>
              </CardHeader>
              <CardContent>
                {invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    {t("customers.no_invoices")}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("customers.invoice_number")}</TableHead>
                        <TableHead>{t("customers.date")}</TableHead>
                        <TableHead className="text-right">{t("common.total")}</TableHead>
                        <TableHead>{t("invoices.status")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((inv: any) => (
                        <TableRow
                          key={inv.id}
                          className="cursor-pointer hover:bg-accent/50 transition-colors"
                          onClick={() => navigate(`/invoices/${inv.id}`)}
                        >
                          <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(inv.issue_date)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(inv.total, inv.currency)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={STATUS_COLORS[inv.status]}>
                              {t(`invoices.status_${inv.status}`)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </form>
  );
}
