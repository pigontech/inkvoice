import { Check, Download, Mail, Pencil, Plus, Save, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { Slot } from "@/components/layout/slot-registry";
import { ApiTokensCard } from "@/components/shared/ApiTokensCard";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FormField } from "@/components/shared/FormField";
import { OutgoingWebhooksCard } from "@/components/shared/OutgoingWebhooksCard";
import { PaymentTermsPicker } from "@/components/shared/PaymentTermsPicker";
import { ReminderRulesCard } from "@/components/shared/ReminderRulesCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { type Language, languages, useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";
import ProductSettings from "@/pages/ProductSettings";
import { getSettingsTabs } from "@/pages/settings-tab-registry";
import Templates from "@/pages/Templates";
import { extractColors } from "@/utils/color-extractor";

function isLightColor(hex: string): boolean {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 160;
}

function previewInvoiceNumber(pattern: string): string {
  if (!pattern) return "";
  const now = new Date();
  let result = pattern;
  result = result.replace("{YYYY}", String(now.getFullYear()));
  result = result.replace("{YY}", String(now.getFullYear()).slice(-2));
  result = result.replace("{MM}", String(now.getMonth() + 1).padStart(2, "0"));
  result = result.replace("{DD}", String(now.getDate()).padStart(2, "0"));
  result = result.replace("{SEQ}", "1");
  result = result.replace("{SEQ4}", "0001");
  result = result.replace("{RAND4}", String(Math.floor(Math.random() * 10000)).padStart(4, "0"));
  return result;
}

const BASE_SETTINGS_TABS = [
  "general",
  "business",
  "invoicing",
  "tax",
  "email",
  "payments",
  "reminders",
  "products",
  "templates",
  "api",
] as const;
type SettingsTab = string; // Validated dynamically via the tab registry + base set.

function isSettingsTab(value: string | undefined, extraTabs: string[] = []): value is SettingsTab {
  if (!value) return false;
  return (BASE_SETTINGS_TABS as readonly string[]).includes(value) || extraTabs.includes(value);
}

export default function Settings() {
  const { language, setLanguage, t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { tab: tabParam } = useParams<{ tab: string }>();
  // Detect /settings/templates/* sub-routes (new, :id/edit)
  const isTemplateSubRoute = location.pathname.startsWith("/settings/templates/");
  // Registered at bootstrap (before first render), so reading once is safe.
  const extraTabs = useMemo(() => getSettingsTabs().map((t) => t.id), []);
  const tab: SettingsTab = isTemplateSubRoute
    ? "templates"
    : isSettingsTab(tabParam, extraTabs)
      ? (tabParam as SettingsTab)
      : "general";
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [pendingLanguage, setPendingLanguage] = useState<Language>(language);
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [logoColors, setLogoColors] = useState<string[]>([]);
  const [taxDefs, setTaxDefs] = useState<any[]>([]);
  const [taxDialogOpen, setTaxDialogOpen] = useState(false);
  const [editingTax, setEditingTax] = useState<any | null>(null);
  const [taxForm, setTaxForm] = useState({ name: "", rate: "", description: "" });
  const [deletingTaxId, setDeletingTaxId] = useState<string | null>(null);
  const [taxLoading, setTaxLoading] = useState(false);

  useEffect(() => {
    api.getSettings().then((r) => setSettings(r.data));
    api.listTaxDefinitions().then((r) => setTaxDefs(r.data));
  }, []);

  const extractLogoColors = useCallback((logoUrl: string) => {
    if (!logoUrl) {
      setLogoColors([]);
      return;
    }
    extractColors(logoUrl, 5)
      .then(setLogoColors)
      .catch(() => setLogoColors([]));
  }, []);

  useEffect(() => {
    extractLogoColors(settings.company_logo || "");
  }, [settings.company_logo, extractLogoColors]);

  useEffect(() => {
    if (tabParam && !isSettingsTab(tabParam, extraTabs) && !isTemplateSubRoute) {
      navigate("/settings/general", { replace: true });
    }
  }, [tabParam, navigate, isTemplateSubRoute, extraTabs]);

  const handleSave = async () => {
    const email = settings.company_email || "";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Invalid email address");
      return;
    }
    setEmailError("");
    setLoading(true);
    try {
      const res = await api.updateSettings(settings);
      setSettings(res.data);
      if (pendingLanguage !== language) {
        setLanguage(pendingLanguage);
      }
      toast.success(t("settings.settings_saved"));
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await api.uploadLogo(file);
      setSettings({ ...settings, company_logo: res.data.logo });
      toast.success(t("settings.logo_uploaded"));
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    }
  };

  const handleWatermarkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await api.uploadWatermark(file);
      setSettings({
        ...settings,
        watermark_image: res.data.watermark,
        watermark_enabled: settings.watermark_enabled || "true",
      });
      toast.success(t("settings.watermark_uploaded"));
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    }
  };

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setSettings({ ...settings, [key]: e.target.value });

  const [demoBusy, setDemoBusy] = useState<"sample" | "reset" | null>(null);
  const [demoResetConfirmOpen, setDemoResetConfirmOpen] = useState(false);

  const handleSeedSampleData = async () => {
    setDemoBusy("sample");
    try {
      const res = await api.seedSampleData();
      toast.success(
        t("settings.sample_data_loaded", {
          customers: String(res.data.customers),
          products: String(res.data.products),
          invoices: String(res.data.invoices),
        }),
      );
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setDemoBusy(null);
    }
  };

  const handleResetDemo = async () => {
    setDemoBusy("reset");
    setDemoResetConfirmOpen(false);
    try {
      await api.resetDemoData();
      toast.success(t("settings.demo_data_reset"));
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setDemoBusy(null);
    }
  };

  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [wipeConfirmOpen, setWipeConfirmOpen] = useState(false);
  const [wipeConfirmText, setWipeConfirmText] = useState("");
  const [wipeBusy, setWipeBusy] = useState(false);

  const handleRestore = async () => {
    if (!restoreFile) return;
    setRestoreConfirmOpen(false);
    setRestoreBusy(true);
    try {
      const formData = new FormData();
      formData.append("backup", restoreFile);
      const res = await fetch(api.restoreUrl(), {
        method: "POST",
        headers: { Authorization: `Bearer ${api.getAuthToken() ?? ""}` },
        credentials: "include",
        body: formData,
      });
      const body = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !body.success) {
        toast.error(body.error || t("settings.restore_error"));
        return;
      }
      toast.success(t("settings.restore_success"));
      // Hard reload — backend has reopened the DB on a different file.
      setTimeout(() => window.location.reload(), 800);
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setRestoreBusy(false);
      setRestoreFile(null);
    }
  };

  const handleWipe = async () => {
    if (wipeConfirmText !== "DELETE") return;
    setWipeBusy(true);
    setWipeConfirmOpen(false);
    try {
      const res = await fetch(api.wipeUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${api.getAuthToken() ?? ""}`,
        },
        credentials: "include",
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      const body = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !body.success) {
        toast.error(body.error || t("settings.wipe_error"));
        return;
      }
      toast.success(t("settings.wipe_success"));
      setTimeout(() => window.location.reload(), 800);
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setWipeBusy(false);
      setWipeConfirmText("");
    }
  };

  const openAddTax = () => {
    setEditingTax(null);
    setTaxForm({ name: "", rate: "", description: "" });
    setTaxDialogOpen(true);
  };

  const openEditTax = (tax: any) => {
    setEditingTax(tax);
    setTaxForm({ name: tax.name, rate: String(tax.rate), description: tax.description || "" });
    setTaxDialogOpen(true);
  };

  const handleSaveTax = async () => {
    if (!taxForm.name.trim()) return;
    setTaxLoading(true);
    try {
      const payload = {
        name: taxForm.name,
        rate: parseFloat(taxForm.rate) || 0,
        description: taxForm.description || undefined,
      };
      if (editingTax) {
        await api.updateTaxDefinition(editingTax.id, payload);
        toast.success(t("settings.tax_updated"));
      } else {
        await api.createTaxDefinition(payload);
        toast.success(t("settings.tax_created"));
      }
      const r = await api.listTaxDefinitions();
      setTaxDefs(r.data);
      setTaxDialogOpen(false);
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setTaxLoading(false);
    }
  };

  const handleDeleteTax = async () => {
    if (!deletingTaxId) return;
    setTaxLoading(true);
    try {
      await api.deleteTaxDefinition(deletingTaxId);
      toast.success(t("settings.tax_deleted"));
      const r = await api.listTaxDefinitions();
      setTaxDefs(r.data);
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setTaxLoading(false);
      setDeletingTaxId(null);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>

      <Tabs value={tab} onValueChange={(v) => navigate(`/settings/${v}`)}>
        <TabsList>
          <TabsTrigger value="general">{t("settings.tab_general")}</TabsTrigger>
          <TabsTrigger value="business">{t("settings.tab_business")}</TabsTrigger>
          <TabsTrigger value="invoicing">{t("settings.tab_invoicing")}</TabsTrigger>
          <TabsTrigger value="tax">{t("settings.tab_tax")}</TabsTrigger>
          <TabsTrigger value="email">{t("settings.tab_email")}</TabsTrigger>
          <TabsTrigger value="payments">{t("settings.tab_payments")}</TabsTrigger>
          <TabsTrigger value="reminders">{t("settings.tab_reminders")}</TabsTrigger>
          <TabsTrigger value="products">{t("settings.tab_products")}</TabsTrigger>
          <TabsTrigger value="templates">{t("settings.tab_templates")}</TabsTrigger>
          <TabsTrigger value="api">{t("settings.tab_api")}</TabsTrigger>
          {getSettingsTabs().map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {t(tab.label)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="general" className="max-w-3xl">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-sm">{t("settings.preferences")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField label={t("settings.language")} hint={t("settings.language_hint")}>
                <select
                  value={pendingLanguage}
                  onChange={(e) => setPendingLanguage(e.target.value as Language)}
                  className="form-select"
                >
                  {(Object.entries(languages) as [Language, string][]).map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField label={t("settings.currency")}>
                  <select
                    value={settings.currency || "USD"}
                    onChange={(e) => setSettings({ ...settings, currency: e.target.value })}
                    className="form-select"
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="TRY">TRY</option>
                    <option value="JPY">JPY</option>
                    <option value="CAD">CAD</option>
                    <option value="AUD">AUD</option>
                    <option value="CHF">CHF</option>
                  </select>
                </FormField>
                <FormField label={t("settings.locale")} hint={t("settings.locale_hint")}>
                  <Input
                    value={settings.locale || ""}
                    onChange={set("locale")}
                    placeholder="en-US"
                  />
                </FormField>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  label={t("settings.base_currency")}
                  hint={t("settings.base_currency_hint")}
                >
                  <select
                    value={settings.base_currency || settings.currency || "USD"}
                    onChange={(e) => setSettings({ ...settings, base_currency: e.target.value })}
                    className="form-select"
                  >
                    {["USD", "EUR", "GBP", "TRY", "JPY", "CAD", "AUD", "CHF"].map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField
                  label={t("settings.auto_fetch_rates")}
                  hint={t("settings.auto_fetch_rates_hint")}
                >
                  <label className="flex items-center gap-2 h-9">
                    <input
                      type="checkbox"
                      checked={settings.exchange_rate_auto_fetch === "true"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          exchange_rate_auto_fetch: e.target.checked ? "true" : "false",
                        })
                      }
                      className="rounded"
                    />
                    <span className="text-sm text-muted-foreground">
                      {t("settings.auto_fetch_rates_label")}
                    </span>
                  </label>
                </FormField>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField label={t("settings.date_format")}>
                  <select
                    value={settings.date_format || "YYYY-MM-DD"}
                    onChange={(e) => setSettings({ ...settings, date_format: e.target.value })}
                    className="form-select"
                  >
                    <option value="YYYY-MM-DD">YYYY-MM-DD (2026-12-31)</option>
                    <option value="DD.MM.YYYY">DD.MM.YYYY (31.12.2026)</option>
                    <option value="DD/MM/YYYY">DD/MM/YYYY (31/12/2026)</option>
                    <option value="MM/DD/YYYY">MM/DD/YYYY (12/31/2026)</option>
                  </select>
                </FormField>
                <FormField label={t("settings.number_format")}>
                  <select
                    value={settings.number_format || "1,000.00"}
                    onChange={(e) => setSettings({ ...settings, number_format: e.target.value })}
                    className="form-select"
                  >
                    <option value="1,000.00">1,000.00 (US/UK)</option>
                    <option value="1.000,00">1.000,00 (EU)</option>
                    <option value="1 000,00">1 000,00 (FR)</option>
                  </select>
                </FormField>
              </div>
              <FormField
                label={t("settings.fiscal_year_start")}
                hint={t("settings.fiscal_year_start_hint")}
              >
                <select
                  value={settings.fiscal_year_start_month || "1"}
                  onChange={(e) =>
                    setSettings({ ...settings, fiscal_year_start_month: e.target.value })
                  }
                  className="form-select"
                >
                  {Array.from({ length: 12 }, (_, i) => {
                    const monthName = new Intl.DateTimeFormat(settings.locale || "en-US", {
                      month: "long",
                    }).format(new Date(2000, i, 1));
                    return (
                      <option key={i + 1} value={String(i + 1)}>
                        {monthName}
                      </option>
                    );
                  })}
                </select>
              </FormField>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-sm">{t("settings.data_backup")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                {t("settings.backup_description")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => window.open(api.backupUrl(), "_blank")}>
                  <Download className="h-4 w-4 mr-2" /> {t("settings.download_backup_json")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => window.open(api.sqliteBackupUrl(), "_blank")}
                >
                  <Download className="h-4 w-4 mr-2" /> {t("settings.download_backup_sqlite")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                {t("settings.backup_format_hint")}
              </p>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-sm">{t("settings.restore_section")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                {t("settings.restore_description")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="restore-file-input"
                  type="file"
                  accept=".db,application/octet-stream"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setRestoreFile(f);
                    if (f) setRestoreConfirmOpen(true);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  disabled={restoreBusy}
                  onClick={() => document.getElementById("restore-file-input")?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" /> {t("settings.restore_button")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4 border-destructive/50">
            <CardHeader>
              <CardTitle className="text-sm">{t("settings.wipe_section")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">{t("settings.wipe_description")}</p>
              <Button
                variant="destructive"
                disabled={wipeBusy}
                onClick={() => setWipeConfirmOpen(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" /> {t("settings.wipe_button")}
              </Button>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-sm">{t("settings.demo_section")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">
                  {t("settings.sample_data_description")}
                </p>
                <Button
                  variant="outline"
                  onClick={handleSeedSampleData}
                  disabled={demoBusy !== null}
                >
                  {demoBusy === "sample"
                    ? t("settings.sample_data_loading")
                    : t("settings.load_sample_data")}
                </Button>
              </div>
              {settings.demo_mode === "true" && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-muted-foreground mb-2">
                    {t("settings.demo_reset_description")}
                  </p>
                  <Button
                    variant="destructive"
                    onClick={() => setDemoResetConfirmOpen(true)}
                    disabled={demoBusy !== null}
                  >
                    {t("settings.reset_demo")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <ConfirmDialog
            open={demoResetConfirmOpen}
            onOpenChange={setDemoResetConfirmOpen}
            title={t("settings.demo_reset_confirm_title")}
            description={t("settings.demo_reset_confirm_body")}
            variant="destructive"
            confirmLabel={t("settings.reset_demo")}
            onConfirm={handleResetDemo}
            loading={demoBusy === "reset"}
          />

          <ConfirmDialog
            open={restoreConfirmOpen}
            onOpenChange={(o) => {
              setRestoreConfirmOpen(o);
              if (!o) setRestoreFile(null);
            }}
            title={t("settings.restore_confirm_title")}
            description={t("settings.restore_confirm_body")}
            variant="destructive"
            confirmLabel={t("settings.restore_cta")}
            onConfirm={handleRestore}
            loading={restoreBusy}
          />

          <Dialog
            open={wipeConfirmOpen}
            onOpenChange={(o) => {
              setWipeConfirmOpen(o);
              if (!o) setWipeConfirmText("");
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{t("settings.wipe_confirm_title")}</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">{t("settings.wipe_confirm_body")}</p>
              <FormField label={t("settings.wipe_confirm_text")}>
                <Input
                  autoFocus
                  value={wipeConfirmText}
                  onChange={(e) => setWipeConfirmText(e.target.value)}
                  placeholder="DELETE"
                />
              </FormField>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setWipeConfirmOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  variant="destructive"
                  disabled={wipeConfirmText !== "DELETE" || wipeBusy}
                  onClick={handleWipe}
                >
                  {t("settings.wipe_cta")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="business" className="max-w-3xl">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-sm">{t("settings.company_info")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField label={t("settings.company_name")}>
                <Input value={settings.company_name || ""} onChange={set("company_name")} />
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField label={t("settings.email")} error={emailError}>
                  <Input
                    type="email"
                    value={settings.company_email || ""}
                    onChange={(e) => {
                      setSettings({ ...settings, company_email: e.target.value });
                      setEmailError("");
                    }}
                    onBlur={() => {
                      const v = settings.company_email || "";
                      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
                        setEmailError("Invalid email address");
                      else setEmailError("");
                    }}
                    aria-invalid={!!emailError}
                  />
                </FormField>
                <FormField label={t("settings.phone")}>
                  <Input value={settings.company_phone || ""} onChange={set("company_phone")} />
                </FormField>
              </div>
              <FormField label={t("settings.address")}>
                <Textarea
                  value={settings.company_address || ""}
                  onChange={set("company_address")}
                  rows={2}
                />
              </FormField>
              <FormField label={t("settings.tax_id")}>
                <Input value={settings.company_tax_id || ""} onChange={set("company_tax_id")} />
              </FormField>
              <FormField label={t("settings.bank_details")} hint={t("settings.bank_details_hint")}>
                <Textarea
                  value={settings.company_bank_details || ""}
                  onChange={set("company_bank_details")}
                  rows={4}
                  placeholder={"IBAN: …\nBIC: …\nBank name …"}
                />
              </FormField>
              <FormField label={t("settings.logo")}>
                <div className="flex items-center gap-4 mt-1">
                  {settings.company_logo && (
                    <div className="relative">
                      <img
                        src={settings.company_logo}
                        alt={t("settings.logo")}
                        loading="lazy"
                        className="h-16 w-auto border rounded-lg"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute -top-2 -right-2 h-6 w-6"
                        aria-label={t("a11y.remove_logo")}
                        onClick={() => setSettings({ ...settings, company_logo: "" })}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleLogoUpload}
                    />
                    <div className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm hover:bg-accent transition-colors">
                      <Upload className="h-4 w-4" /> {t("settings.upload_logo")}
                    </div>
                  </label>
                </div>
                {logoColors.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground mb-1.5">
                      {t("settings.suggested_colors")}
                    </p>
                    <div className="flex gap-2">
                      {logoColors.map((color) => {
                        const isSelected = settings.accent_color === color;
                        return (
                          <button
                            key={color}
                            type="button"
                            className="relative h-8 w-8 rounded-full border-2 transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2"
                            style={{
                              backgroundColor: color,
                              borderColor: isSelected ? color : "transparent",
                            }}
                            title={color}
                            onClick={() => {
                              setSettings({ ...settings, accent_color: color });
                            }}
                          >
                            {isSelected && (
                              <Check
                                className="absolute inset-0 m-auto h-4 w-4"
                                style={{ color: isLightColor(color) ? "#000" : "#fff" }}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </FormField>
              <FormField label={t("settings.watermark")} hint={t("settings.watermark_hint")}>
                <div className="flex items-center gap-4 mt-1">
                  {settings.watermark_image && (
                    <div className="relative">
                      <img
                        src={settings.watermark_image}
                        alt=""
                        loading="lazy"
                        className="h-16 w-auto border rounded-lg bg-muted"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute -top-2 -right-2 h-6 w-6"
                        aria-label={t("a11y.remove_watermark")}
                        onClick={() => setSettings({ ...settings, watermark_image: "" })}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleWatermarkUpload}
                    />
                    <div className="flex items-center gap-2 px-4 py-2 border rounded-lg text-sm hover:bg-accent transition-colors">
                      <Upload className="h-4 w-4" /> {t("settings.upload_watermark")}
                    </div>
                  </label>
                </div>
                {settings.watermark_image && (
                  <label className="mt-3 inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={settings.watermark_enabled === "true"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          watermark_enabled: e.target.checked ? "true" : "false",
                        })
                      }
                    />
                    {t("settings.watermark_enabled")}
                  </label>
                )}
              </FormField>

              <FormField label={t("settings.public_url")} hint={t("settings.public_url_hint")}>
                <Input
                  value={settings.public_url || ""}
                  onChange={set("public_url")}
                  placeholder="https://invoices.example.com"
                  type="url"
                />
              </FormField>

              <FormField label={t("settings.pdf_qr_code")}>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.pdf_qr_code_enabled === "true"}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        pdf_qr_code_enabled: e.target.checked ? "true" : "false",
                      })
                    }
                    disabled={!settings.public_url}
                  />
                  {t("settings.pdf_qr_code_enabled")}
                </label>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("settings.pdf_qr_code_hint")}
                </p>
              </FormField>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoicing" className="max-w-3xl">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-sm">{t("settings.invoice_defaults")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField label={t("settings.invoice_number_pattern")}>
                <Input
                  value={settings.invoice_number_pattern || ""}
                  onChange={set("invoice_number_pattern")}
                  placeholder="INV-{YYYY}-{SEQ4}"
                />
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>{t("settings.pattern_variables")}</p>
                  {settings.invoice_number_pattern && (
                    <p>
                      {t("settings.preview")}{" "}
                      <span className="font-medium text-foreground">
                        {previewInvoiceNumber(settings.invoice_number_pattern)}
                      </span>
                    </p>
                  )}
                </div>
              </FormField>
              <FormField label={t("settings.default_payment_terms")}>
                <PaymentTermsPicker
                  value={settings.default_payment_terms || ""}
                  onChange={(value) => setSettings({ ...settings, default_payment_terms: value })}
                />
              </FormField>
              <FormField label={t("settings.default_notes")}>
                <Textarea
                  value={settings.default_notes || ""}
                  onChange={set("default_notes")}
                  rows={3}
                />
              </FormField>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tax" className="max-w-3xl">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-sm">{t("settings.tax_settings")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FormField label={t("settings.tax_label")}>
                  <Input
                    value={settings.tax_label || ""}
                    onChange={set("tax_label")}
                    placeholder={t("settings.tax_label_placeholder")}
                  />
                </FormField>
                <FormField label={t("settings.default_tax_rate")}>
                  <NumberInput
                    value={settings.default_tax_rate || "0"}
                    min={0}
                    max={100}
                    decimals={2}
                    onValueChange={(v) => setSettings({ ...settings, default_tax_rate: String(v) })}
                  />
                </FormField>
                <FormField label={t("settings.prices_include_tax")}>
                  <select
                    value={settings.prices_include_tax || "false"}
                    onChange={(e) =>
                      setSettings({ ...settings, prices_include_tax: e.target.value })
                    }
                    className="form-select"
                  >
                    <option value="false">{t("common.no")}</option>
                    <option value="true">{t("common.yes")}</option>
                  </select>
                </FormField>
              </div>
              <FormField label={t("settings.tax_rounding_mode")}>
                <select
                  value={settings.tax_rounding_mode || "line"}
                  onChange={(e) => setSettings({ ...settings, tax_rounding_mode: e.target.value })}
                  className="form-select"
                >
                  <option value="line">{t("settings.rounding_per_line")}</option>
                  <option value="total">{t("settings.rounding_on_total")}</option>
                </select>
              </FormField>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{t("settings.tax_definitions")}</CardTitle>
                <Button variant="outline" size="sm" onClick={openAddTax}>
                  <Plus className="h-4 w-4 mr-1" /> {t("settings.add_tax")}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {taxDefs.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-6">
                  {t("settings.no_tax_definitions")}
                </p>
              ) : (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left px-4 py-2 font-medium">
                          {t("settings.tax_name")}
                        </th>
                        <th className="text-left px-4 py-2 font-medium">
                          {t("settings.tax_rate")}
                        </th>
                        <th className="text-left px-4 py-2 font-medium">
                          {t("settings.tax_description")}
                        </th>
                        <th className="text-right px-4 py-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {taxDefs.map((td) => (
                        <tr key={td.id} className="border-b last:border-b-0">
                          <td className="px-4 py-2">{td.name}</td>
                          <td className="px-4 py-2">{td.rate}%</td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {td.description || "—"}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => openEditTax(td)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => setDeletingTaxId(td.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Dialog open={taxDialogOpen} onOpenChange={setTaxDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {editingTax ? t("settings.edit_tax") : t("settings.add_tax")}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <FormField label={t("settings.tax_name")}>
                  <Input
                    value={taxForm.name}
                    onChange={(e) => setTaxForm({ ...taxForm, name: e.target.value })}
                    placeholder={t("settings.tax_label_placeholder")}
                  />
                </FormField>
                <FormField label={t("settings.tax_rate")}>
                  <NumberInput
                    value={taxForm.rate}
                    min={0}
                    max={100}
                    decimals={2}
                    onValueChange={(v) => setTaxForm({ ...taxForm, rate: String(v) })}
                  />
                </FormField>
                <FormField label={t("settings.tax_description")}>
                  <Input
                    value={taxForm.description}
                    onChange={(e) => setTaxForm({ ...taxForm, description: e.target.value })}
                  />
                </FormField>
              </div>
              <DialogFooter>
                <Button onClick={handleSaveTax} disabled={taxLoading || !taxForm.name.trim()}>
                  <Save className="h-4 w-4 mr-1" />
                  {taxLoading ? t("common.saving") : t("common.save")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <ConfirmDialog
            open={!!deletingTaxId}
            onOpenChange={(open) => {
              if (!open) setDeletingTaxId(null);
            }}
            title={t("settings.tax_deleted")}
            description={t("settings.confirm_delete_tax")}
            variant="destructive"
            confirmLabel={t("common.delete")}
            onConfirm={handleDeleteTax}
            loading={taxLoading}
          />
        </TabsContent>

        <TabsContent value="email" className="max-w-3xl">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Mail className="h-4 w-4" /> {t("settings.email_config")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t("settings.smtp_status")}</span>
                {settings.email_configured === "true" ? (
                  <span className="text-emerald-600 font-medium">
                    {t("settings.smtp_configured")}
                  </span>
                ) : (
                  <span className="text-amber-600 font-medium">
                    {t("settings.smtp_not_configured")}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{t("settings.smtp_info")}</p>
              <FormField label={t("settings.from_name")} hint={t("settings.from_name_hint")}>
                <Input
                  value={settings.email_from_name || ""}
                  onChange={set("email_from_name")}
                  placeholder={t("settings.from_name_placeholder")}
                />
              </FormField>
              <FormField label={t("settings.reply_to")}>
                <Input
                  type="email"
                  value={settings.email_reply_to || ""}
                  onChange={set("email_reply_to")}
                  placeholder="reply@example.com"
                />
              </FormField>
              <FormField label={t("settings.email_footer")}>
                <Textarea
                  value={settings.email_footer_text || ""}
                  onChange={set("email_footer_text")}
                  rows={2}
                  placeholder={t("settings.email_footer_placeholder")}
                />
              </FormField>
              <div className="pt-2 border-t space-y-3">
                <div>
                  <p className="text-sm font-medium">{t("settings.invoice_email_template")}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settings.invoice_email_template_hint")}
                  </p>
                </div>
                <FormField label={t("settings.email_template_subject")}>
                  <Input
                    value={settings.invoice_email_subject || ""}
                    onChange={set("invoice_email_subject")}
                    placeholder={t("settings.email_template_subject_default")}
                  />
                </FormField>
                <FormField label={t("settings.email_template_body")}>
                  <Textarea
                    value={settings.invoice_email_body || ""}
                    onChange={set("invoice_email_body")}
                    rows={8}
                    className="font-mono text-xs"
                    placeholder={t("settings.email_template_body_default")}
                  />
                </FormField>
                <p className="text-[11px] text-muted-foreground">
                  {t("settings.email_template_variables")}
                </p>
              </div>
              {settings.email_configured === "true" && (
                <div className="pt-2 border-t">
                  <p className="text-sm font-medium mb-2">{t("settings.test_connection")}</p>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="test@example.com"
                      id="test-email-input"
                      className="max-w-xs"
                    />
                    <Button
                      variant="outline"
                      onClick={async () => {
                        const input = document.getElementById(
                          "test-email-input",
                        ) as HTMLInputElement;
                        if (!input?.value) return;
                        try {
                          await api.testEmail(input.value);
                          toast.success("Test email sent!");
                        } catch (err: unknown) {
                          toast.error(formatApiError(err, t));
                        }
                      }}
                    >
                      {t("settings.send_test")}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-sm">{t("settings.notifications_title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.notify_on_invoice_view === "true"}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      notify_on_invoice_view: e.target.checked ? "true" : "false",
                    })
                  }
                  className="rounded"
                />
                {t("settings.notify_on_invoice_view")}
              </label>
              <p className="text-xs text-muted-foreground">
                {t("settings.notify_on_invoice_view_hint")}
              </p>
            </CardContent>
          </Card>

          <OutgoingWebhooksCard />
        </TabsContent>
        <TabsContent value="payments" className="max-w-3xl">
          {/* Overlay-provided payment integrations (e.g. platform Connect). */}
          <Slot name="settings-payments" />
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-sm">{t("settings.stripe_title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{t("settings.stripe_info")}</p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.stripe_enabled === "true"}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      stripe_enabled: e.target.checked ? "true" : "false",
                    })
                  }
                  className="rounded"
                />
                {t("settings.stripe_enable")}
              </label>
            </CardContent>
          </Card>
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-sm">{t("settings.paypal_title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{t("settings.paypal_info")}</p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.paypal_enabled === "true"}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      paypal_enabled: e.target.checked ? "true" : "false",
                    })
                  }
                  className="rounded"
                />
                {t("settings.paypal_enable")}
              </label>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="reminders" className="max-w-3xl">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-sm">{t("settings.payment_reminders")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">{t("settings.reminders_info")}</p>
              <p className="text-sm text-muted-foreground">{t("settings.reminders_variables")}</p>
            </CardContent>
          </Card>

          <ReminderRulesCard />

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-sm">{t("settings.late_fees")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.late_fee_enabled === "true"}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      late_fee_enabled: e.target.checked ? "true" : "false",
                    })
                  }
                  className="rounded"
                />
                {t("settings.enable_late_fees")}
              </label>
              {settings.late_fee_enabled === "true" && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField label={t("settings.fee_type")}>
                      <select
                        value={settings.late_fee_type || "percentage"}
                        onChange={(e) =>
                          setSettings({ ...settings, late_fee_type: e.target.value })
                        }
                        className="form-select"
                      >
                        <option value="percentage">{t("settings.fee_type_percentage")}</option>
                        <option value="fixed">{t("settings.fee_type_fixed")}</option>
                      </select>
                    </FormField>
                    <FormField label={t("settings.fee_value")}>
                      <NumberInput
                        value={settings.late_fee_value || ""}
                        min={0}
                        decimals={2}
                        onValueChange={(v) =>
                          setSettings({ ...settings, late_fee_value: String(v) })
                        }
                      />
                    </FormField>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField label={t("settings.grace_period")}>
                      <NumberInput
                        value={settings.late_fee_grace_days || ""}
                        min={0}
                        integer
                        onValueChange={(v) =>
                          setSettings({ ...settings, late_fee_grace_days: String(v) })
                        }
                      />
                    </FormField>
                    <FormField label={t("settings.fee_frequency")}>
                      <select
                        value={settings.late_fee_frequency || "once"}
                        onChange={(e) =>
                          setSettings({ ...settings, late_fee_frequency: e.target.value })
                        }
                        className="form-select"
                      >
                        <option value="once">{t("settings.fee_once")}</option>
                        <option value="monthly">{t("settings.fee_monthly")}</option>
                      </select>
                    </FormField>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="products">
          <div className="mt-4">
            <ProductSettings />
          </div>
        </TabsContent>
        <TabsContent value="templates">
          <div className="mt-4">
            <Templates />
          </div>
        </TabsContent>
        <TabsContent value="api" className="max-w-3xl">
          <ApiTokensCard />
        </TabsContent>

        {getSettingsTabs().map((spec) => (
          <TabsContent key={spec.id} value={spec.id} className="space-y-4">
            {spec.content}
          </TabsContent>
        ))}
      </Tabs>

      {tab !== "templates" &&
        tab !== "products" &&
        !getSettingsTabs().some((s) => s.id === tab && s.hideSave) && (
          <Button onClick={handleSave} disabled={loading}>
            <Save className="h-4 w-4 mr-1" />
            {loading ? t("common.saving") : t("settings.save_settings")}
          </Button>
        )}
    </div>
  );
}
