import { Clock, Copy, DollarSign, FileText, Loader2, Save, SearchCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { FormField } from "@/components/shared/FormField";
import { TagInput } from "@/components/shared/TagInput";
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
import { sumOutstanding } from "@/lib/outstanding";
import { pushRecentlyViewed } from "@/lib/recently-viewed";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings.store";

interface Props {
  onSave: () => void;
}

export default function CustomerForm({ onSave }: Props) {
  const { t, language } = useTranslation();
  const einvoiceEnabled = useSettingsStore((s) => s.settings.einvoice_enabled === "true");
  const peppolEnabled = useSettingsStore((s) => s.settings.peppol_enabled === "true");
  const franceEnabled = useSettingsStore((s) => s.settings.france_enabled === "true");
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  // Set when arriving via "Add customer" from another page (e.g. the invoice
  // form): pre-fill the name and return to the caller on cancel/save.
  const navState = location.state as { returnTo?: string; prefillName?: string } | null;
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
  const [peppolChecking, setPeppolChecking] = useState(false);
  const [peppolResult, setPeppolResult] = useState<{
    ok: "reachable" | "unreachable" | "conflict" | "error";
    detail: string;
  } | null>(null);
  const [checkingFrance, setCheckingFrance] = useState(false);
  const [franceReachable, setFranceReachable] = useState<boolean | null>(null);
  const [franceResult, setFranceResult] = useState<string | null>(null);
  async function checkFrance() {
    if (!form.siren) return;
    setCheckingFrance(true);
    setFranceResult(null);
    try {
      const res = await api.franceLookup(form.siren, isEdit ? id : undefined);
      if (res.success) {
        setFranceReachable(res.data.exists);
        setFranceResult(
          res.data.exists ? t("customers.france_reachable") : t("customers.france_unreachable"),
        );
      } else {
        setFranceResult(t("customers.france_check_error"));
      }
    } catch (err) {
      setFranceResult(formatApiError(err, t));
    } finally {
      setCheckingFrance(false);
    }
  }
  const [form, setForm] = useState({
    name: navState?.prefillName ?? "",
    email: "",
    phone: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    postal_code: "",
    country: "",
    tax_id: "",
    tax_number: "",
    einvoice_format: "",
    leitweg_id: "",
    einvoice_receiver_id: "",
    einvoice_receiver_scheme: "",
    siren: "",
    siret: "",
    france_reachable: 0,
    notes: "",
    language: "",
    default_template_id: "",
    currency: "",
    tags: [] as string[],
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
    api.listTags().then((r) => setTagSuggestions(r.data.map((t) => t.name)));
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
          tax_number: d.tax_number || "",
          einvoice_format: d.einvoice_format || "",
          leitweg_id: d.leitweg_id || "",
          einvoice_receiver_id: d.einvoice_receiver_id || "",
          einvoice_receiver_scheme: d.einvoice_receiver_scheme || "",
          siren: d.siren || "",
          siret: d.siret || "",
          france_reachable: d.france_reachable ?? 0,
          notes: d.notes || "",
          language: d.language || "",
          default_template_id: d.default_template_id || "",
          currency: d.currency || "",
          tags: d.tags || [],
        });
        setFranceReachable(d.france_reachable === 1);
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

  const outstanding = sumOutstanding(invoices);

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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigate(navState?.returnTo || "/customers")}
          >
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
                        {/* Curated names exist for en/tr; other UI languages fall back to English. */}
                        {language === "tr" ? c.tr : c.en}
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

          {einvoiceEnabled && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t("customers.einvoice_section")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  label={t("customers.einvoice_format")}
                  hint={t("customers.einvoice_format_hint")}
                >
                  <select
                    value={form.einvoice_format}
                    onChange={(e) => setForm({ ...form, einvoice_format: e.target.value })}
                    className="form-select"
                  >
                    <option value="">{t("customers.einvoice_format_inherit")}</option>
                    <option value="zugferd">ZUGFeRD 2.2</option>
                    <option value="xrechnung">XRechnung (UBL)</option>
                    <option value="peppol">PEPPOL BIS 3.0</option>
                  </select>
                </FormField>
                <FormField label={t("customers.tax_number")} hint={t("customers.tax_number_hint")}>
                  <Input
                    value={form.tax_number}
                    onChange={set("tax_number")}
                    placeholder="12/345/67890"
                  />
                </FormField>
                <FormField label={t("customers.leitweg_id")} hint={t("customers.leitweg_id_hint")}>
                  <Input
                    value={form.leitweg_id}
                    onChange={set("leitweg_id")}
                    placeholder="99040000000012345678"
                  />
                </FormField>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    label={t("customers.einvoice_receiver_id")}
                    hint={t("customers.einvoice_receiver_id_hint")}
                  >
                    <Input
                      value={form.einvoice_receiver_id}
                      onChange={set("einvoice_receiver_id")}
                    />
                  </FormField>
                  <FormField
                    label={t("customers.einvoice_receiver_scheme")}
                    hint={t("customers.einvoice_receiver_scheme_hint")}
                  >
                    <Input
                      value={form.einvoice_receiver_scheme}
                      onChange={set("einvoice_receiver_scheme")}
                      placeholder="DE:VAT"
                    />
                  </FormField>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label={t("customers.siren")} hint={t("customers.siren_hint")}>
                    <Input
                      value={form.siren ?? ""}
                      onChange={(e) => {
                        set("siren")(e);
                        setFranceReachable(null);
                        setFranceResult(null);
                      }}
                      placeholder="123456789"
                      maxLength={9}
                    />
                  </FormField>
                  <FormField label={t("customers.siret")} hint={t("customers.siret_hint")}>
                    <Input
                      value={form.siret ?? ""}
                      onChange={set("siret")}
                      placeholder="12345678900012"
                      maxLength={14}
                    />
                  </FormField>
                </div>
                {franceEnabled && (
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm text-muted-foreground">
                      {franceResult ||
                        (franceReachable === null
                          ? ""
                          : franceReachable
                            ? t("customers.france_reachable")
                            : t("customers.france_unreachable"))}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!form.siren || checkingFrance}
                      onClick={checkFrance}
                    >
                      {t("customers.france_check")}
                    </Button>
                  </div>
                )}
                {peppolEnabled && (
                  <div className="pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        peppolChecking ||
                        !form.einvoice_receiver_id ||
                        !form.einvoice_receiver_scheme
                      }
                      onClick={async () => {
                        setPeppolChecking(true);
                        setPeppolResult(null);
                        try {
                          const res = await api.lookupPeppolParticipant(
                            form.einvoice_receiver_scheme,
                            form.einvoice_receiver_id,
                            isEdit ? id : undefined,
                          );
                          const cap = res.data;
                          if (cap.servedElsewhere) {
                            setPeppolResult({
                              ok: "conflict",
                              detail: cap.accessPointName
                                ? t("peppol.lookup_conflict_with", {
                                    name: cap.accessPointName,
                                  })
                                : t("peppol.lookup_conflict"),
                            });
                          } else if (cap.exists) {
                            setPeppolResult({
                              ok: "reachable",
                              detail: t("peppol.lookup_reachable", {
                                types: cap.documentTypes.join(", ") || "invoice",
                              }),
                            });
                          } else {
                            setPeppolResult({
                              ok: "unreachable",
                              detail: t("peppol.lookup_unreachable"),
                            });
                          }
                        } catch (err) {
                          setPeppolResult({ ok: "error", detail: formatApiError(err, t) });
                        } finally {
                          setPeppolChecking(false);
                        }
                      }}
                    >
                      {peppolChecking ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <SearchCheck className="h-4 w-4" />
                      )}
                      {t("peppol.check_button")}
                    </Button>
                    {peppolResult && (
                      <p
                        className={`mt-2 text-sm ${
                          peppolResult.ok === "reachable"
                            ? "text-green-600 dark:text-green-400"
                            : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {peppolResult.detail}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

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
              <FormField label={t("tags.title")} hint={t("tags.hint")}>
                <TagInput
                  value={form.tags}
                  onChange={(tags) => setForm((f) => ({ ...f, tags }))}
                  suggestions={tagSuggestions}
                  placeholder={t("tags.placeholder")}
                  ariaLabel={t("tags.title")}
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
