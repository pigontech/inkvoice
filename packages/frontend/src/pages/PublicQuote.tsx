import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "@/i18n";

async function readPreviewErrorMessage(
  res: Response,
  notFoundLabel: string,
  fallback: string,
): Promise<string> {
  if (res.status === 404) return notFoundLabel;
  try {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const j = (await res.json()) as { error?: string };
      if (typeof j?.error === "string" && j.error.length > 0) return j.error;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

export default function PublicQuote() {
  const { t } = useTranslation();
  const { shareToken } = useParams();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [html, setHtml] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const previewRes = await fetch(`/api/v1/public/quotes/${shareToken}/preview`);
        if (!previewRes.ok) {
          const msg = await readPreviewErrorMessage(
            previewRes,
            t("public.quote_not_found"),
            t("public.document_unavailable"),
          );
          if (!cancelled) {
            setError(msg);
            setLoading(false);
          }
          return;
        }
        const previewText = await previewRes.text();
        const jsonRes = await fetch(`/api/v1/public/quotes/${shareToken}`);
        const jsonData = await jsonRes.json().catch(() => null);
        if (!cancelled) {
          setHtml(previewText);
          if (jsonData?.data?.quote) setStatus(jsonData.data.quote.status);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError(t("public.document_unavailable"));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shareToken, t]);

  if (error) {
    return (
      <div className="text-center py-20">
        <h2 className="text-xl text-muted-foreground">{error}</h2>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20" role="status">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        <span className="sr-only">{t("common.loading")}</span>
      </div>
    );
  }

  const handleDecision = async (decision: "accept" | "reject") => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/public/quotes/${shareToken}/${decision}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setStatus(data.data?.status || (decision === "accept" ? "accepted" : "rejected"));
        toast.success(
          decision === "accept" ? t("public.quote_accepted") : t("public.quote_rejected"),
        );
      } else {
        const fallback =
          decision === "accept" ? t("public.accept_failed") : t("public.reject_failed");
        toast.error(typeof data?.error === "string" ? data.error : fallback);
      }
    } catch {
      toast.error(decision === "accept" ? t("public.accept_failed") : t("public.reject_failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const canDecide = status === "draft" || status === "sent";

  return (
    <div>
      <iframe
        sandbox="allow-same-origin"
        srcDoc={html}
        className="w-full border-0"
        style={{ minHeight: "900px" }}
        title={t("public.quote")}
      />
      {canDecide && (
        <div className="flex justify-center gap-3 py-6">
          <button
            type="button"
            onClick={() => handleDecision("accept")}
            disabled={submitting}
            className="px-8 py-3 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-lg"
          >
            {t("public.accept_quote")}
          </button>
          <button
            type="button"
            onClick={() => handleDecision("reject")}
            disabled={submitting}
            className="px-8 py-3 border border-input font-semibold rounded-lg hover:bg-accent disabled:opacity-50 text-lg"
          >
            {t("public.reject_quote")}
          </button>
        </div>
      )}
      {status === "accepted" && (
        <div className="flex justify-center py-6">
          <p className="text-emerald-600 font-semibold text-lg">{t("public.quote_accepted")}</p>
        </div>
      )}
      {status === "rejected" && (
        <div className="flex justify-center py-6">
          <p className="text-muted-foreground font-semibold text-lg">
            {t("public.quote_rejected")}
          </p>
        </div>
      )}
    </div>
  );
}
