import { FileText, Printer } from "lucide-react";
import { useEffect, useRef } from "react";
import { Outlet, useLocation, useParams } from "react-router-dom";
import { useTranslation } from "@/i18n";

export function PublicLayout() {
  const { t } = useTranslation();
  const { shareToken } = useParams();
  const location = useLocation();
  const printIframeRef = useRef<HTMLIFrameElement>(null);

  // The layout is shared by the public invoice and quote pages — pick the
  // label (header + document title) and preview endpoint by route.
  const isQuote = location.pathname.startsWith("/public/quote/");
  const docLabel = isQuote ? t("public.quote") : t("public.invoice");

  useEffect(() => {
    const previous = document.title;
    document.title = `${docLabel} — Inkvoice`;
    return () => {
      document.title = previous;
    };
  }, [docLabel]);

  async function handlePrint() {
    try {
      const res = await fetch(
        `/api/v1/public/${isQuote ? "quotes" : "invoices"}/${shareToken}/preview`,
      );
      if (!res.ok) return;
      const html = await res.text();
      const iframe = printIframeRef.current;
      if (!iframe) return;
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) return;
      const printHtml = html.includes("</head>")
        ? html.replace(
            "</head>",
            "<style>@page { size: A4; margin: 10mm; } body { padding: 10mm; }</style></head>",
          )
        : html;
      doc.open();
      doc.write(printHtml);
      doc.close();
      setTimeout(() => {
        iframe.contentWindow?.print();
      }, 300);
    } catch {}
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between px-6 h-14 border-b bg-card print:hidden">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          <span className="font-semibold">{docLabel}</span>
        </div>
        {shareToken && (
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground cursor-pointer"
          >
            <Printer className="h-4 w-4" />
            {t("public.print_save_pdf")}
          </button>
        )}
      </header>
      <main className="max-w-4xl mx-auto py-8 px-4">
        <Outlet />
      </main>
      <iframe
        ref={printIframeRef}
        style={{
          position: "fixed",
          left: "-9999px",
          top: 0,
          width: "210mm",
          height: "297mm",
          border: "none",
        }}
        title="Print"
      />
    </div>
  );
}
