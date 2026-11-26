import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { InkvoiceLogo } from "@/components/InkvoiceLogo";
import { Slot } from "@/components/layout/slot-registry";
import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { required, useFormValidation } from "@/hooks/use-form-validation";
import { useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";
import { useAuthStore } from "@/stores/auth.store";

export default function Login() {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [demo, setDemo] = useState<{ username: string; password: string } | null>(null);
  const [sso, setSso] = useState<{ enabled: boolean; providerName: string | null } | null>(null);
  const OIDC_ERROR_CODES = new Set([
    "invalid_state",
    "auth_failed",
    "email_required",
    "unverified_email",
    "domain_not_allowed",
    "provisioning_disabled",
    "user_inactive",
    "misconfigured",
  ]);
  const oidcErrorParam = new URLSearchParams(window.location.search).get("oidc_error");
  const oidcError = oidcErrorParam
    ? OIDC_ERROR_CODES.has(oidcErrorParam)
      ? oidcErrorParam
      : "auth_failed"
    : null;
  const login = useAuthStore((s) => s.login);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { t } = useTranslation();

  const { validateAll, onBlur, onChange, getError } = useFormValidation({
    username: [required(t("validation.required", { field: t("auth.username") }))],
    password: [required(t("validation.required", { field: t("auth.password") }))],
  });

  // A public demo runs on throwaway credentials nobody can guess, so the
  // instance tells us what they are. Fails soft: a deployment that doesn't
  // serve this endpoint simply gets no hint.
  useEffect(() => {
    api
      .getPublicConfig()
      .then((res) => {
        setDemo(res.data.demo_credentials);
        setSso({
          enabled: res.data.oidc_enabled,
          providerName: res.data.oidc_provider_name,
        });
      })
      .catch(() => {});
  }, []);

  const update = (field: "username" | "password") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const newForm = { ...form, [field]: e.target.value };
    setForm(newForm);
    onChange(field, newForm);
  };

  const fillDemo = () => {
    if (!demo) return;
    setForm(demo);
    // Clear any "required" errors already showing on the touched fields.
    onChange("username", demo);
    onChange("password", demo);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateAll(form)) return;
    setError("");
    setLoading(true);
    try {
      await login(form.username, form.password);
      navigate("/");
    } catch (err: unknown) {
      setError(formatApiError(err, t));
    } finally {
      setLoading(false);
    }
  };

  // Already signed in (active session, OAuth return, or a manual visit to
  // /login): skip the form and go straight to the dashboard home page.
  if (user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <InkvoiceLogo className="h-16" />
          </div>
          <CardTitle className="text-xl">{t("auth.welcome_back")}</CardTitle>
          <CardDescription>{t("auth.sign_in_to")}</CardDescription>
        </CardHeader>
        <CardContent>
          {sso?.enabled && (
            <>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  window.location.href = "/api/v1/auth/oidc/start";
                }}
              >
                {sso.providerName
                  ? t("auth.sign_in_with_provider", { provider: sso.providerName })
                  : t("auth.sign_in_with_sso")}
              </Button>
              <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                <span>{t("auth.sso_or")}</span>
                <div className="h-px flex-1 bg-border" />
              </div>
            </>
          )}
          {oidcError && (
            <div className="mb-4 text-sm text-destructive bg-destructive/10 rounded-lg p-3 animate-slide-down">
              {t(`auth.oidc_error.${oidcError}`)}
            </div>
          )}
          {/* Overlay-provided sign-in alternatives (e.g. OAuth buttons). */}
          <Slot name="login-oauth" />
          {demo && (
            <div
              role="status"
              className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-300/40 bg-amber-100 p-3 text-sm text-amber-800 dark:border-amber-700/30 dark:bg-amber-900/40 dark:text-amber-200"
            >
              <span>
                {t("auth.demo_credentials")}{" "}
                <span className="font-mono font-semibold">
                  {demo.username} / {demo.password}
                </span>
              </span>
              <Button type="button" variant="outline" size="sm" onClick={fillDemo}>
                {t("auth.demo_fill")}
              </Button>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3 animate-slide-down">
                {error}
              </div>
            )}
            <FormField label={t("auth.username")} error={getError("username")} required>
              <Input
                value={form.username}
                onChange={update("username")}
                onBlur={() => onBlur("username", form)}
                aria-invalid={!!getError("username")}
                autoComplete="username"
                autoFocus
              />
            </FormField>
            <FormField label={t("auth.password")} error={getError("password")} required>
              <Input
                type="password"
                value={form.password}
                onChange={update("password")}
                onBlur={() => onBlur("password", form)}
                aria-invalid={!!getError("password")}
                autoComplete="current-password"
              />
            </FormField>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t("auth.signing_in") : t("auth.sign_in")}
            </Button>
          </form>
          {/* Overlay-provided footer (e.g. a sign-up link). */}
          <Slot name="login-footer" />
        </CardContent>
      </Card>
    </div>
  );
}
