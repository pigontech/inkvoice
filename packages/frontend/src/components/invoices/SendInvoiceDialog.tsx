import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
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
import { formatApiError } from "@/lib/format-api-error";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  customerEmail: string | null;
  invoiceNumber: string;
  onSuccess: () => void;
  type?: "invoice" | "quote";
}

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
  const [to, setTo] = useState(customerEmail || "");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [from, setFrom] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);

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
              placeholder="Auto-generated if empty"
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
