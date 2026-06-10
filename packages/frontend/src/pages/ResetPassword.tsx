import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "@/i18n";

export default function ResetPassword() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!token) {
      setError(t("auth.reset_token_missing") || "Reset link is missing or invalid.");
      return;
    }
    if (password.length < 12) {
      setError(t("auth.password_too_short") || "Password must be at least 12 characters.");
      return;
    }
    if (password !== confirm) {
      setError(t("auth.passwords_do_not_match") || "Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (res.status === 200) {
        navigate("/login?reset=success");
        return;
      }
      if (res.status === 410) {
        setError(
          t("auth.reset_token_expired") || "This reset link has expired or has already been used.",
        );
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || t("auth.reset_error") || "Reset failed. Please try again.");
      }
    } catch {
      setError(t("auth.reset_error") || "Reset failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("auth.reset_title") || "Choose a new password"}</CardTitle>
          <CardDescription>
            {t("auth.reset_description") || "Pick a strong password — at least 12 characters."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="password">{t("auth.new_password") || "New password"}</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={12}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirm">{t("auth.confirm_password") || "Confirm password"}</Label>
              <Input
                id="confirm"
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={12}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={loading || !token}>
              {loading ? t("common.loading") : t("auth.reset_button") || "Reset password"}
            </Button>
            <Link to="/login" className="text-sm text-muted-foreground hover:underline text-center">
              {t("auth.back_to_login") || "Back to login"}
            </Link>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
