import { MessageSquare } from "lucide-react";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/i18n";

export function FeedbackButton() {
  const { t } = useTranslation();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      toast.error(t("feedback.too_short"));
      return;
    }
    setSubmitting(true);
    try {
      await api.submitFeedback({ message: trimmed, page_url: location.pathname });
      toast.success(t("feedback.success"));
      setMessage("");
      setOpen(false);
    } catch {
      toast.error(t("feedback.error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("feedback.button")}
        className="fixed bottom-4 right-4 z-40 h-10 gap-2 rounded-md shadow-[0_10px_30px_-10px_var(--primary)] hover:shadow-[0_14px_36px_-8px_var(--primary)] hover:-translate-y-0.5 transition-all"
      >
        <MessageSquare className="h-4 w-4" />
        {t("feedback.button")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("feedback.title")}</DialogTitle>
              <DialogDescription>{t("feedback.description")}</DialogDescription>
            </DialogHeader>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("feedback.placeholder")}
              rows={5}
              maxLength={5000}
              autoFocus
              required
            />
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={submitting || !message.trim()}>
                {submitting ? t("feedback.submitting") : t("feedback.submit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
