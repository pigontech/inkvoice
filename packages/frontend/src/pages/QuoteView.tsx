import {
  Ban,
  CheckCircle,
  Copy,
  Eye,
  FileText,
  Globe,
  Loader2,
  MoreHorizontal,
  Pencil,
  Send,
  Share2,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { SendInvoiceDialog } from "@/components/invoices/SendInvoiceDialog";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";
import { pushRecentlyViewed } from "@/lib/recently-viewed";
import { formatCurrency, formatDate } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  accepted: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  expired: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  converted: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
};

export default function QuoteView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [quote, setQuote] = useState<any>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: string;
    title: string;
    description: string;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const printIframeRef = useRef<HTMLIFrameElement>(null);

  const fetchQuote = useCallback(() => {
    api.getQuote(id!).then((r) => {
      setQuote(r.data);
      if (r.data?.quote_number) {
        pushRecentlyViewed({
          type: "quote",
          id: id!,
          label: r.data.quote_number,
          sublabel: r.data.customer?.name ?? undefined,
        });
      }
    });
  }, [id]);

  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  if (!quote) {
    return (
      <div className="flex justify-center py-12" role="status">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        <span className="sr-only">{t("common.loading")}</span>
      </div>
    );
  }

  const executeAction = async () => {
    if (!confirmAction) return;
    setActionLoading(true);
    try {
      if (confirmAction.type === "accept") {
        await api.acceptQuote(id!);
        toast.success(t("quotes.accepted"));
        fetchQuote();
      } else if (confirmAction.type === "reject") {
        await api.rejectQuote(id!);
        toast.success(t("quotes.rejected"));
        fetchQuote();
      } else if (confirmAction.type === "delete") {
        await api.deleteQuote(id!);
        toast.success(t("quotes.deleted"));
        navigate("/quotes/all");
      }
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  const handleConvert = async () => {
    try {
      const res = await api.convertQuoteToInvoice(id!);
      toast.success(t("quotes.converted"));
      navigate(`/invoices/${res.data.invoice_id}`);
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    }
  };

  const handleDuplicate = async () => {
    try {
      const res = await api.duplicateQuote(id!);
      toast.success(t("quotes.duplicated"));
      navigate(`/quotes/${res.data.id}`);
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    }
  };

  const handlePublish = async () => {
    try {
      await api.publishQuote(id!);
      toast.success(t("quotes.published"));
      fetchQuote();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    }
  };

  const handlePreview = async () => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const html = await api.previewQuote(id!);
      setPreviewHtml(html);
    } catch {
      toast.error(t("quotes.failed_preview"));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePrint = async () => {
    try {
      const html = previewHtml || (await api.previewQuote(id!));
      if (!previewHtml) setPreviewHtml(html);
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
    } catch {
      toast.error(t("quotes.failed_print"));
    }
  };

  const copyShareLink = () => {
    if (quote.share_token) {
      navigator.clipboard.writeText(`${window.location.origin}/public/quote/${quote.share_token}`);
      toast.success(t("quotes.share_link_copied"));
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: t("nav.dashboard"), href: "/" },
          { label: t("nav.quotes"), href: "/quotes/all" },
          { label: quote.quote_number },
        ]}
      />

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight truncate">{quote.quote_number}</h1>
          <Badge variant="secondary" className={STATUS_COLORS[quote.status]}>
            {t(("quotes.status_" + quote.status) as any)}
          </Badge>
          <span className="text-sm text-muted-foreground truncate">{quote.customer?.name}</span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {quote.status === "draft" && (
            <Button variant="outline" size="sm" onClick={() => navigate(`/quotes/${id}/edit`)}>
              <Pencil className="h-4 w-4 mr-1" /> {t("common.edit")}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handlePreview}>
            <Eye className="h-4 w-4 mr-1" /> {t("invoices.preview")}
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            {t("public.print_save_pdf")}
          </Button>

          {["draft", "sent"].includes(quote.status) && (
            <Button size="sm" variant="outline" onClick={() => setSendDialogOpen(true)}>
              <Send className="h-4 w-4 mr-1" /> {t("invoices.send")}
            </Button>
          )}

          {(["sent", "accepted"].includes(quote.status) ||
            (!!quote.is_published && quote.status === "draft")) && (
            <Button size="sm" onClick={handleConvert}>
              <FileText className="h-4 w-4 mr-1" /> {t("quotes.convert_to_invoice")}
            </Button>
          )}
          {(quote.status === "sent" || (!!quote.is_published && quote.status === "draft")) && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setConfirmAction({
                    type: "accept",
                    title: t("quotes.accept_title"),
                    description: t("quotes.confirm_accept"),
                  })
                }
              >
                <CheckCircle className="h-4 w-4 mr-1" /> {t("quotes.accept")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setConfirmAction({
                    type: "reject",
                    title: t("quotes.reject_title"),
                    description: t("quotes.confirm_reject"),
                  })
                }
              >
                <Ban className="h-4 w-4 mr-1" /> {t("quotes.reject")}
              </Button>
            </>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={t("a11y.more_actions")}
                />
              }
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleDuplicate}>
                <Copy className="h-4 w-4 mr-2" /> {t("invoices.duplicate")}
              </DropdownMenuItem>
              {!quote.is_published && ["draft", "sent"].includes(quote.status) && (
                <DropdownMenuItem onClick={handlePublish}>
                  <Globe className="h-4 w-4 mr-2" /> {t("invoices.publish")}
                </DropdownMenuItem>
              )}
              {!!quote.is_published && (
                <DropdownMenuItem onClick={copyShareLink}>
                  <Share2 className="h-4 w-4 mr-2" /> {t("invoices.copy_link")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() =>
                  setConfirmAction({
                    type: "delete",
                    title: t("quotes.delete_title"),
                    description: t("quotes.confirm_delete"),
                  })
                }
              >
                <Trash2 className="h-4 w-4 mr-2" /> {t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!!quote.is_published && quote.share_token && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200/60 dark:border-emerald-900/30 bg-emerald-50/40 dark:bg-emerald-950/20 px-3 py-2 text-sm">
          <Globe className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
          <span className="text-emerald-800 dark:text-emerald-300 text-[11px] font-semibold uppercase tracking-wider shrink-0">
            {t("invoices.share_link")}
          </span>
          <code className="flex-1 truncate text-xs font-mono text-muted-foreground select-all">
            {`${window.location.origin}/public/quote/${quote.share_token}`}
          </code>
          <Button
            variant="outline"
            size="xs"
            onClick={copyShareLink}
            aria-label={t("invoices.copy_link")}
          >
            <Copy className="h-3.5 w-3.5 mr-1" /> {t("invoices.copy_link")}
          </Button>
        </div>
      )}

      {quote.converted_invoice_id && (
        <div className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/30 px-4 py-3 text-sm">
          <FileText className="h-4 w-4 text-purple-600" />
          {t("quotes.converted_to_invoice")}{" "}
          <button
            className="font-medium text-primary hover:underline"
            onClick={() => navigate(`/invoices/${quote.converted_invoice_id}`)}
          >
            {t("public.invoice")}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("quotes.quote_details")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("quotes.issue_date")}</span>
              <span>{formatDate(quote.issue_date)}</span>
            </div>
            {quote.valid_until && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("quotes.valid_until")}</span>
                <span>{formatDate(quote.valid_until)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("invoices.currency")}</span>
              <span>{quote.currency}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("quotes.customer")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="font-medium">{quote.customer?.name}</p>
            {quote.customer?.email && (
              <p className="text-muted-foreground mt-0.5">{quote.customer.email}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("quotes.line_items")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("quotes.description")}</TableHead>
                <TableHead className="text-right">{t("quotes.qty")}</TableHead>
                <TableHead>{t("quotes.unit")}</TableHead>
                <TableHead className="text-right">{t("quotes.unit_price")}</TableHead>
                <TableHead className="text-right">{t("quotes.tax")}</TableHead>
                <TableHead className="text-right">{t("common.total")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quote.items?.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                  <TableCell className="text-muted-foreground capitalize">{item.unit}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(item.unit_price, quote.currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{item.tax_rate}%</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatCurrency(item.line_total, quote.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="w-full max-w-xs ml-auto space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("quotes.subtotal")}</span>
              <span className="tabular-nums">{formatCurrency(quote.subtotal, quote.currency)}</span>
            </div>
            {quote.discount_amount > 0 && (
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{t("quotes.discount")}</span>
                <span className="tabular-nums">
                  -{formatCurrency(quote.discount_amount, quote.currency)}
                </span>
              </div>
            )}
            {quote.tax_total > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("quotes.tax")}</span>
                <span className="tabular-nums">
                  {formatCurrency(quote.tax_total, quote.currency)}
                </span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-semibold text-lg">
              <span>{t("common.total")}</span>
              <span className="tabular-nums">{formatCurrency(quote.total, quote.currency)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {quote.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("quotes.notes")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{quote.notes}</p>
          </CardContent>
        </Card>
      )}

      <SendInvoiceDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        invoiceId={id!}
        customerEmail={quote.customer?.email || null}
        invoiceNumber={quote.quote_number}
        onSuccess={fetchQuote}
        type="quote"
      />

      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={confirmAction?.title || ""}
        description={confirmAction?.description || ""}
        confirmLabel={
          { delete: t("common.delete"), reject: t("quotes.reject"), accept: t("quotes.accept") }[
            confirmAction?.type ?? ""
          ] ?? t("common.confirm")
        }
        variant={
          confirmAction?.type === "delete" || confirmAction?.type === "reject"
            ? "destructive"
            : "default"
        }
        onConfirm={executeAction}
        loading={actionLoading}
      />

      {/* Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-4xl h-[80vh]">
          {previewLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <iframe
              sandbox="allow-same-origin"
              srcDoc={previewHtml.replace("</head>", "<style>body{padding:40px}</style></head>")}
              className="w-full h-full border-0 rounded"
              title="Quote Preview"
            />
          )}
        </DialogContent>
      </Dialog>

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
