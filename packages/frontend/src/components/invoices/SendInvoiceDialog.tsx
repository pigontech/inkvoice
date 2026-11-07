import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/i18n";
import { type EinvoiceIssue, einvoiceIssueText } from "@/lib/einvoice-issues";
import { formatApiError } from "@/lib/format-api-error";
import { useSettingsStore } from "@/stores/settings.store";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  customerEmail: string | null;
  invoiceNumber: string;
  onSuccess: () => void;
  type?: "invoice" | "quote";
}

// `send_dialog.einvoice_file.*` key per "<format>:<file>" the backend plans to attach.
const EINVOICE_FILE_KEYS: Record<string, string> = {
  "zugferd:pdf": "zugferd_pdf",
  "zugferd:xml": "zugferd_xml",
  "xrechnung-ubl:xml": "xrechnung_xml",
  "peppol:xml": "peppol_xml",
};

export function SendInvoiceDialog({
  open,
  onOpenChange,
  invoiceId,
  customerEmail,
  invoiceNumber,
  onSuccess,
  type = "invoice",
}: Props) {
  const { t } = useTranslation();
  const einvoiceEnabled = useSettingsStore((s) => s.settings.einvoice_enabled === "true");
  const [to, setTo] = useState(customerEmail || "");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [from, setFrom] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [attachEinvoice, setAttachEinvoice] = useState(true);
  const [einvoiceErrors, setEinvoiceErrors] = useState<EinvoiceIssue[]>([]);
  // The file this email would carry (the format follows the customer, e.g. a
  // Leitweg-ID means XRechnung); null hides the option, nothing would attach.
  const [einvoiceFile, setEinvoiceFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Warn before an e-invoice with errors goes out with the email.
  useEffect(() => {
    if (!open || type !== "invoice" || !einvoiceEnabled) {
      setEinvoiceErrors([]);
      setEinvoiceFile(null);
      return;
    }
    let cancelled = false;
    api
      .checkEinvoice(invoiceId)
      .then((r) => {
        if (cancelled) return;
        setEinvoiceErrors(r.data.issues.filter((i) => i.severity === "error"));
        setEinvoiceFile(EINVOICE_FILE_KEYS[`${r.data.format}:${r.data.file}`] ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setEinvoiceErrors([]);
        setEinvoiceFile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, type, einvoiceEnabled, invoiceId]);
  const showEinvoice = type === "invoice" && einvoiceEnabled && einvoiceFile !== null;
  const einvoiceWarning = showEinvoice && einvoiceErrors.length > 0;
  const attachLabel = t("send_dialog.attach_einvoice", {
    format: t(`send_dialog.einvoice_file.${einvoiceFile}`),
  });

  const handleSubmit = async () => {
    if (!to) {
      toast.error(t("send_dialog.recipient_required"));
      return;
    }
    setLoading(true);
    try {
      const sendFn = type === "quote" ? api.sendQuote : api.sendInvoice;
      await sendFn(invoiceId, {
        to,
        subject: subject || undefined,
        message: message || undefined,
        from: from || undefined,
        reply_to: replyTo || undefined,
        ...(type === "invoice" ? { attach_einvoice: attachEinvoice } : {}),
      });
      toast.success(type === "quote" ? t("send_dialog.quote_sent") : t("send_dialog.invoice_sent"));
      onOpenChange(false);
      onSuccess();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {type === "quote"
              ? t("send_dialog.send_quote", { number: invoiceNumber })
              : t("send_dialog.send_invoice", { number: invoiceNumber })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <FormField label={t("send_dialog.to")}>
            <Input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="customer@example.com"
            />
          </FormField>
          <FormField label={t("send_dialog.subject")} hint={t("send_dialog.subject_hint")}>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t("send_dialog.subject_placeholder")}
            />
          </FormField>
          <FormField label={t("send_dialog.message")} hint={t("send_dialog.message_hint")}>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder={t("common.optional")}
            />
          </FormField>
          {einvoiceWarning && (
            <div
              className="rounded-md border border-destructive/40 p-3 text-sm"
              data-testid="einvoice-send-warning"
            >
              <p className="font-medium">{t("send_dialog.einvoice_errors_title")}</p>
              <ul className="mt-1 space-y-1 text-destructive">
                {einvoiceErrors.map((issue) => (
                  <li key={issue.code}>{einvoiceIssueText(issue, t)}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                {t("send_dialog.einvoice_errors_hint")}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Checkbox
                  id="attach-einvoice-warning"
                  checked={attachEinvoice}
                  onCheckedChange={(checked) => setAttachEinvoice(checked === true)}
                />
                <label htmlFor="attach-einvoice-warning" className="font-medium">
                  {attachLabel}
                </label>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {showAdvanced ? "− " : "+ "}
            {t("send_dialog.advanced")}
          </button>
          {showAdvanced && (
            <div className="space-y-4 border-l-2 border-muted pl-4">
              <FormField label={t("send_dialog.from")} hint={t("send_dialog.from_hint")}>
                <Input
                  type="email"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  placeholder="billing@example.com"
                />
              </FormField>
              <FormField label={t("send_dialog.reply_to")} hint={t("send_dialog.reply_to_hint")}>
                <Input
                  type="email"
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  placeholder="support@example.com"
                />
              </FormField>
              {showEinvoice && !einvoiceWarning && (
                <div className="flex items-start gap-2 text-sm">
                  <Checkbox
                    id="attach-einvoice"
                    checked={attachEinvoice}
                    onCheckedChange={(checked) => setAttachEinvoice(checked === true)}
                    className="mt-0.5"
                  />
                  <label htmlFor="attach-einvoice">
                    <span className="font-medium">{attachLabel}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("send_dialog.attach_einvoice_hint")}
                    </span>
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            {t("send_dialog.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
