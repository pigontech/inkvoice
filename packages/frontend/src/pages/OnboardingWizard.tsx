import { Loader2, Upload } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n";
import { detectDefaultCountry, findPresetByCountry, REGION_PRESETS } from "@/i18n/region-presets";
import { formatApiError } from "@/lib/format-api-error";
import { useSettingsStore } from "@/stores/settings.store";

const TOTAL_STEPS = 4;

export default function OnboardingWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const initialSettings = useSettingsStore((s) => s.settings);

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [companyName, setCompanyName] = useState(
    initialSettings.company_name && initialSettings.company_name !== "My Company"
      ? initialSettings.company_name
      : "",
  );
  const [country, setCountry] = useState<string>(() => detectDefaultCountry());
  const initialPreset = findPresetByCountry(country);
  const [currency, setCurrency] = useState(
    initialSettings.currency || initialPreset?.currency || "USD",
  );
  const [locale, setLocale] = useState(initialSettings.locale || initialPreset?.locale || "en-US");
  const [dateFormat, setDateFormat] = useState(
    initialSettings.date_format || initialPreset?.date_format || "MM/dd/yyyy",
  );
  const [logo, setLogo] = useState<string | null>(initialSettings.company_logo || null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await api.uploadLogo(file);
      setLogo(res.data.logo);
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    }
  };

  const finish = async (skipCustomer: boolean) => {
    setBusy(true);
    try {
      const settingsUpdate: Record<string, string> = {
        onboarding_completed: "true",
      };
      if (companyName) settingsUpdate.company_name = companyName;
      if (currency) settingsUpdate.currency = currency;
      if (locale) settingsUpdate.locale = locale;
      if (dateFormat) settingsUpdate.date_format = dateFormat;
      await api.updateSettings(settingsUpdate);

      if (!skipCustomer && customerName.trim()) {
        await api.createCustomer({
          name: customerName.trim(),
          email: customerEmail.trim() || undefined,
        });
      }

      await fetchSettings();
      toast.success(t("settings.onboarding_completed_toast"));
      navigate("/", { replace: true });
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    setBusy(true);
    try {
      await api.updateSettings({ onboarding_completed: "true" });
      await fetchSettings();
      navigate("/", { replace: true });
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-xl space-y-4">
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{t("settings.onboarding_title")}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("settings.onboarding_subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={skip}
            disabled={busy}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {t("settings.onboarding_skip")}
          </button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              <span>
                {step === 1 && t("settings.onboarding_region_title")}
                {step === 2 && t("settings.onboarding_business_title")}
                {step === 3 && t("settings.onboarding_logo_title")}
                {step === 4 && t("settings.onboarding_customer_title")}
              </span>
              <span className="text-xs text-muted-foreground font-normal">
                {t("settings.onboarding_step", { step: String(step), total: String(TOTAL_STEPS) })}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === 1 && (
              <>
                <p className="text-sm text-muted-foreground">
                  {t("settings.onboarding_region_hint")}
                </p>
                <FormField label={t("settings.onboarding_country")}>
                  <select
                    value={country}
                    onChange={(e) => {
                      const next = e.target.value;
                      setCountry(next);
                      const preset = findPresetByCountry(next);
                      if (preset) {
                        setCurrency(preset.currency);
                        setLocale(preset.locale);
                        setDateFormat(preset.date_format);
                      }
                    }}
                    className="form-select"
                    // biome-ignore lint/a11y/noAutofocus: intentional focus on wizard step entry
                    autoFocus
                  >
                    {REGION_PRESETS.map((p) => (
                      <option key={p.country} value={p.country}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </FormField>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label={t("settings.currency")}>
                    <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
                  </FormField>
                  <FormField label={t("settings.locale")}>
                    <Input
                      value={locale}
                      onChange={(e) => setLocale(e.target.value)}
                      placeholder="en-US"
                    />
                  </FormField>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("settings.onboarding_region_change_later")}
                </p>
              </>
            )}

            {step === 2 && (
              <>
                <p className="text-sm text-muted-foreground">
                  {t("settings.onboarding_business_hint")}
                </p>
                <FormField label={t("settings.company_name")}>
                  <Input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    autoFocus
                  />
                </FormField>
              </>
            )}

            {step === 3 && (
              <>
                <p className="text-sm text-muted-foreground">
                  {t("settings.onboarding_logo_hint")}
                </p>
                <div className="flex items-center gap-4">
                  {logo && (
                    <img
                      src={logo}
                      alt={t("settings.logo")}
                      loading="lazy"
                      className="h-16 w-auto border rounded-lg"
                    />
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
                <p className="text-xs text-muted-foreground">
                  {t("settings.onboarding_logo_skip_hint")}
                </p>
              </>
            )}

            {step === 4 && (
              <>
                <p className="text-sm text-muted-foreground">
                  {t("settings.onboarding_customer_hint")}
                </p>
                <FormField label={t("settings.onboarding_customer_name")}>
                  <Input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    autoFocus
                  />
                </FormField>
                <FormField label={t("settings.onboarding_customer_email")}>
                  <Input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                  />
                </FormField>
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1 || busy}
          >
            {t("settings.onboarding_back")}
          </Button>
          {step < TOTAL_STEPS ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={busy}>
              {t("settings.onboarding_next")}
            </Button>
          ) : (
            <Button onClick={() => finish(false)} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {t("settings.onboarding_finish")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
