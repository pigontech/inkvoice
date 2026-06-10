import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
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
  const login = useAuthStore((s) => s.login);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { t } = useTranslation();

  const { validateAll, onBlur, onChange, getError } = useFormValidation({
    username: [required(t("validation.required", { field: t("auth.username") }))],
    password: [required(t("validation.required", { field: t("auth.password") }))],
  });

  const update = (field: "username" | "password") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const newForm = { ...form, [field]: e.target.value };
    setForm(newForm);
    onChange(field, newForm);
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
    <div className="min-h-screen flex items-center justify-center bg-background prism-grid-bg p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <InkvoiceLogo className="h-16" />
          </div>
          <CardTitle className="text-xl">{t("auth.welcome_back")}</CardTitle>
          <CardDescription>{t("auth.sign_in_to")}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Overlay-provided sign-in alternatives (e.g. OAuth buttons). */}
          <Slot name="login-oauth" />
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
