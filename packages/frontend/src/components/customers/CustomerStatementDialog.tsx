import { Mail, Printer } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";

function defaultRange(): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}

export function CustomerStatementDialog({
  open,
  onOpenChange,
  customerId,
  customerEmail,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customerId: string;
  customerEmail: string | null;
}) {
  const { t } = useTranslation();
  const init = defaultRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const loadPreview = async (): Promise<string> => {
    setLoading(true);
    try {
      const result = await api.previewStatement(customerId, from, to);
      setHtml(result);
      return result;
    } catch (err) {
      toast.error(formatApiError(err, t));
      return "";
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = async () => {
    const content = html || (await loadPreview());
    const iframe = iframeRef.current;
    if (!content || !iframe) return;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(content);
    doc.close();
    setTimeout(() => iframe.contentWindow?.print(), 300);
  };

  const handleEmail = async () => {
    setSending(true);
    try {
      await api.sendStatement(customerId, { from, to });
      toast.success(t("statements.sent"));
    } catch (err) {
      toast.error(formatApiError(err, t));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("statements.title")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <FormField label={t("statements.from")}>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </FormField>
          <FormField label={t("statements.to")}>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </FormField>
          <Button variant="outline" onClick={loadPreview} disabled={loading}>
            {loading ? t("common.loading") : t("statements.preview")}
          </Button>
        </div>

        <div className="border rounded-md overflow-hidden bg-white h-[420px]">
          {html ? (
            <iframe
              ref={iframeRef}
              title={t("statements.title")}
              srcDoc={html}
              className="w-full h-full"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              {t("statements.preview_hint")}
              {/* Hidden iframe used for printing before a preview is shown. */}
              <iframe ref={iframeRef} title="print" className="hidden" />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {customerEmail
              ? t("statements.email_to", { email: customerEmail })
              : t("statements.no_email")}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1.5" /> {t("statements.print")}
            </Button>
            <Button onClick={handleEmail} disabled={sending || !customerEmail}>
              <Mail className="h-4 w-4 mr-1.5" />
              {sending ? t("common.loading") : t("statements.email")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
