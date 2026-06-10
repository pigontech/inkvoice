import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "@/i18n";

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      // Always treat as success — server returns 202 regardless of whether the
      // email matches a user, by design.
      if (res.status >= 500) {
        setError(t("auth.forgot_error") || "Something went wrong. Please try again.");
      } else {
        setSubmitted(true);
      }
    } catch {
      setError(t("auth.forgot_error") || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("auth.forgot_title") || "Reset your password"}</CardTitle>
          <CardDescription>
            {t("auth.forgot_description") ||
              "Enter the email associated with your account and we'll send you a link to reset your password."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <div className="space-y-4">
              <p className="text-sm">
                {t("auth.forgot_sent") ||
                  "If this email is registered, a reset link has been sent. Check your inbox."}
              </p>
              <Link to="/login" className="text-primary hover:underline text-sm">
                {t("auth.back_to_login") || "Back to login"}
              </Link>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">{t("auth.email") || "Email"}</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" disabled={loading}>
                {loading ? t("common.loading") : t("auth.send_reset_link") || "Send reset link"}
              </Button>
              <Link
                to="/login"
                className="text-sm text-muted-foreground hover:underline text-center"
              >
                {t("auth.back_to_login") || "Back to login"}
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
