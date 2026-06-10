import {
  Ban,
  Braces,
  CheckCircle,
  ClipboardList,
  Copy,
  Eye,
  FileText,
  Globe,
  Loader2,
  MoreHorizontal,
  Pencil,
  Printer,
  ReceiptText,
  Send,
  Share2,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { PaymentHistory } from "@/components/invoices/PaymentHistory";
import { RecordPaymentDialog } from "@/components/invoices/RecordPaymentDialog";
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
import { isInvoiceFormEditable, STATUS_COLORS } from "@/lib/constants";
import { formatApiError } from "@/lib/format-api-error";
import { pushRecentlyViewed } from "@/lib/recently-viewed";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Props {
  onBack: () => void;
}

export default function InvoiceView({ onBack }: Props) {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<any>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: string;
    title: string;
    description: string;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [creditNotes, setCreditNotes] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const printIframeRef = useRef<HTMLIFrameElement>(null);

  const fetchInvoice = useCallback(() => {
    api.getInvoice(id!).then((r) => {
      setInvoice(r.data);
      if (r.data.invoice_number) {
        pushRecentlyViewed({
          type: "invoice",
          id: id!,
          label: r.data.invoice_number,
          sublabel: r.data.customer?.name ?? undefined,
        });
      }
      if (r.data.type !== "credit_note") {
        api.listCreditNotes(id!).then((cn) => setCreditNotes(cn.data));
      }
      api.listPayments(id!).then((p) => setPayments(p.data));
    });
  }, [id]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  if (!invoice) {
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
      if (confirmAction.type === "mark-sent") {
        await api.markSent(id!);
        toast.success(t("invoices.batch_success", { count: 1, action: "marked as sent" }));
        fetchInvoice();
      } else if (confirmAction.type === "publish") {
        await api.publishInvoice(id!);
        toast.success(t("invoices.batch_success", { count: 1, action: "published" }));
        fetchInvoice();
      } else if (confirmAction.type === "unpublish") {
        await api.unpublishInvoice(id!);
        toast.success(t("invoices.batch_success", { count: 1, action: "unpublished" }));
        fetchInvoice();
      } else if (confirmAction.type === "void") {
        await api.voidInvoice(id!);
        toast.success(t("invoices.batch_success", { count: 1, action: "voided" }));
        fetchInvoice();
      } else if (confirmAction.type === "mark-paid") {
        await api.markPaid(id!);
        toast.success(t("invoices.batch_success", { count: 1, action: "marked as paid" }));
        fetchInvoice();
      } else if (confirmAction.type === "mark-complete") {
        await api.markComplete(id!);
        toast.success(t("invoices.invoice_completed"));
        fetchInvoice();
      } else if (confirmAction.type === "delete") {
        await api.deleteInvoice(id!);
        toast.success(t("invoices.batch_success", { count: 1, action: "deleted" }));
        onBack();
      }
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  const handleMarkPaid = () => {
    setConfirmAction({
      type: "mark-paid",
      title: t("invoices.mark_paid"),
      description: t("invoices.confirm_mark_paid"),
    });
  };

  const handleMarkComplete = () => {
    setConfirmAction({
      type: "mark-complete",
      title: t("invoices.mark_complete"),
      description: t("invoices.confirm_mark_complete"),
    });
  };

  const handleDuplicate = async () => {
    try {
      const res = await api.duplicateInvoice(id!);
      toast.success(t("invoices.batch_success", { count: 1, action: "duplicated" }));
      navigate(`/invoices/${res.data.id}`);
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    }
  };

  const handleDuplicateAsQuote = async () => {
    try {
      const res = await api.duplicateInvoiceAsQuote(id!);
      toast.success(t("invoices.duplicated_as_quote"));
      navigate(`/quotes/${res.data.id}`);
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    }
  };

  const handleCreateCreditNote = async () => {
    try {
      const res = await api.createCreditNote(id!);
      toast.success(t("invoices.batch_success", { count: 1, action: "credit note created" }));
      navigate(`/invoices/${res.data.id}`);
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    }
  };

  const handlePublish = async () => {
    try {
      await api.publishInvoice(id!);
      toast.success(t("invoices.batch_success", { count: 1, action: "published" }));
      fetchInvoice();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    }
  };

  const copyShareLink = () => {
    if (invoice.share_token) {
      navigator.clipboard.writeText(
        `${window.location.origin}/public/invoice/${invoice.share_token}`,
      );
      toast.success(t("invoices.link_copied"));
    }
  };

  const handlePreview = async () => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const html = await api.previewInvoice(id!);
      setPreviewHtml(html);
    } catch (_err: any) {
      toast.error(t("invoices.failed_preview"));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handlePrint = async () => {
    try {
      const html = previewHtml || (await api.previewInvoice(id!));
      if (!previewHtml) setPreviewHtml(html);
      const iframe = printIframeRef.current;
      if (!iframe) return;
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) return;
      const printHtml = html.includes("</head>")
        ? html.replace(
            "</head>",
            "<style>@page { size: A4; margin: 5mm; } body { padding: 5mm; }</style></head>",
          )
        : html;
      doc.open();
      doc.write(printHtml);
      doc.close();
      // Wait for content to render before printing
      setTimeout(() => {
        iframe.contentWindow?.print();
      }, 300);
    } catch (_err: any) {
      toast.error(t("invoices.failed_print"));
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: t("nav.dashboard"), href: "/" },
          { label: t("nav.invoices"), href: "/invoices" },
          {
            label: invoice.invoice_number.startsWith("DRAFT-")
              ? `${invoice.invoice_number} (${t("invoices.status_draft")})`
              : invoice.invoice_number,
          },
        ]}
      />

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight truncate">
            {invoice.invoice_number.startsWith("DRAFT-") ? (
              <span className="text-muted-foreground">{invoice.invoice_number}</span>
            ) : (
              invoice.invoice_number
            )}
          </h1>
          <Badge variant="secondary" className={STATUS_COLORS[invoice.status]}>
            {t(`invoices.status_${invoice.status}`)}
          </Badge>
          {invoice.first_viewed_at && (
            <Badge
              variant="secondary"
              className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              title={t("invoices.viewed_on", {
                date: formatDate(invoice.last_viewed_at || invoice.first_viewed_at),
              })}
            >
              <Eye className="h-3 w-3 mr-1" />
              {t("invoices.viewed")}
            </Badge>
          )}
          <span className="text-sm text-muted-foreground truncate">{invoice.customer?.name}</span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {isInvoiceFormEditable(invoice.status) && (
            <Button variant="outline" size="sm" onClick={() => navigate(`/invoices/${id}/edit`)}>
              <Pencil className="h-4 w-4 mr-1" /> {t("common.edit")}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handlePreview}>
            <Eye className="h-4 w-4 mr-1" /> {t("invoices.preview")}
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1" /> {t("invoices.print")}
          </Button>

          {invoice.status === "draft" && (
            <Button
              size="sm"
              onClick={() =>
                setConfirmAction({
                  type: "mark-sent",
                  title: t("invoices.mark_sent"),
                  description: t("invoices.confirm_mark_sent"),
                })
              }
            >
              <Send className="h-4 w-4 mr-1" /> {t("invoices.mark_sent")}
            </Button>
          )}
          {["draft", "sent"].includes(invoice.status) && invoice.type !== "credit_note" && (
            <Button size="sm" variant="outline" onClick={() => setSendDialogOpen(true)}>
              <Send className="h-4 w-4 mr-1" /> {t("invoices.send")}
            </Button>
          )}
          {["sent", "partially_paid", "overdue"].includes(invoice.status) && (
            <Button size="sm" variant="outline" onClick={() => setPaymentDialogOpen(true)}>
              {t("invoices.record_payment")}
            </Button>
          )}
          {["sent", "partially_paid", "overdue"].includes(invoice.status) && (
            <Button size="sm" onClick={handleMarkPaid}>
              <CheckCircle className="h-4 w-4 mr-1" /> {t("invoices.mark_paid")}
            </Button>
          )}
          {invoice.status === "paid" && (
            <Button size="sm" variant="outline" onClick={handleMarkComplete}>
              <CheckCircle className="h-4 w-4 mr-1" /> {t("invoices.mark_complete")}
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={t("invoices.more_actions")}
                />
              }
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleDuplicate}>
                <Copy className="h-4 w-4 mr-2" /> {t("invoices.duplicate")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(JSON.stringify(invoice, null, 2));
                    toast.success(t("invoices.copied_json"));
                  } catch {
                    toast.error(t("invoices.copy_failed"));
                  }
                }}
              >
                <Braces className="h-4 w-4 mr-2" /> {t("invoices.copy_as_json")}
              </DropdownMenuItem>
              {invoice.type !== "credit_note" && (
                <DropdownMenuItem onClick={handleDuplicateAsQuote}>
                  <ClipboardList className="h-4 w-4 mr-2" /> {t("invoices.duplicate_as_quote")}
                </DropdownMenuItem>
              )}
              {["sent", "paid", "overdue", "complete"].includes(invoice.status) &&
                invoice.type !== "credit_note" && (
                  <DropdownMenuItem onClick={handleCreateCreditNote}>
                    <ReceiptText className="h-4 w-4 mr-2" /> {t("invoices.create_credit_note")}
                  </DropdownMenuItem>
                )}
              {invoice.status === "sent" && (
                <DropdownMenuItem
                  onClick={() =>
                    setConfirmAction({
                      type: "void",
                      title: t("invoices.void_invoice"),
                      description: t("invoices.confirm_void"),
                    })
                  }
                >
                  <Ban className="h-4 w-4 mr-2" /> {t("invoices.void")}
                </DropdownMenuItem>
              )}
              {["sent", "paid", "overdue", "complete"].includes(invoice.status) &&
                !invoice.is_published && (
                  <DropdownMenuItem onClick={handlePublish}>
                    <Globe className="h-4 w-4 mr-2" /> {t("invoices.publish")}
                  </DropdownMenuItem>
                )}
              {!!invoice.is_published && (
                <>
                  <DropdownMenuItem
                    onClick={() =>
                      setConfirmAction({
                        type: "unpublish",
                        title: t("invoices.unpublish"),
                        description: t("invoices.confirm_unpublish"),
                      })
                    }
                  >
                    <Globe className="h-4 w-4 mr-2" /> {t("invoices.unpublish")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={copyShareLink}>
                    <Share2 className="h-4 w-4 mr-2" /> {t("invoices.copy_link")}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() =>
                  setConfirmAction({
                    type: "delete",
                    title: t("invoices.delete_invoice"),
                    description: t("invoices.confirm_delete_invoice"),
                  })
                }
              >
                <Trash2 className="h-4 w-4 mr-2" /> {t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Public share link panel */}
      {!!invoice.is_published && invoice.share_token && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200/60 dark:border-emerald-900/30 bg-emerald-50/40 dark:bg-emerald-950/20 px-3 py-2 text-sm">
          <Globe className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
          <span className="text-emerald-800 dark:text-emerald-300 text-[11px] font-semibold uppercase tracking-wider shrink-0">
            {t("invoices.share_link")}
          </span>
          <code className="flex-1 truncate text-xs font-mono text-muted-foreground select-all">
            {`${window.location.origin}/public/invoice/${invoice.share_token}`}
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

      {/* Credit Note Banner */}
      {invoice.type === "credit_note" && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 px-4 py-3 text-sm">
          <ReceiptText className="h-4 w-4 text-amber-600" />
          <span>
            Credit Note for Invoice{" "}
            {invoice.reference_invoice_id ? (
              <button
                className="font-medium text-primary hover:underline"
                onClick={() => navigate(`/invoices/${invoice.reference_invoice_id}`)}
              >
                {invoice.notes?.match(/invoice (.+)/i)?.[1] || invoice.reference_invoice_id}
              </button>
            ) : (
              "N/A"
            )}
          </span>
        </div>
      )}

      {/* Invoice Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("invoices.invoice_details")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("invoices.issue_date")}</span>
              <span>{formatDate(invoice.issue_date)}</span>
            </div>
            {invoice.due_date && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("invoices.due_date")}</span>
                <span>{formatDate(invoice.due_date)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("invoices.currency")}</span>
              <span>{invoice.currency}</span>
            </div>
            {invoice.payment_terms && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("invoices.payment_terms")}</span>
                <span>{invoice.payment_terms}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("invoices.customer")}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="font-medium">{invoice.customer?.name}</p>
            {invoice.customer?.email && (
              <p className="text-muted-foreground mt-0.5">{invoice.customer.email}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Line Items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("invoices.line_items")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("invoices.description")}</TableHead>
                <TableHead className="text-right">{t("invoices.qty")}</TableHead>
                <TableHead>{t("invoices.unit")}</TableHead>
                <TableHead className="text-right">{t("invoices.unit_price")}</TableHead>
                <TableHead className="text-right">{t("invoices.tax")}</TableHead>
                <TableHead className="text-right">{t("common.total")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.items?.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                  <TableCell className="text-muted-foreground capitalize">{item.unit}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(item.unit_price, invoice.currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{item.tax_rate}%</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatCurrency(item.line_total, invoice.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Totals */}
      <Card>
        <CardContent className="pt-6">
          <div className="w-full max-w-xs ml-auto space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("invoices.subtotal")}</span>
              <span className="tabular-nums">
                {formatCurrency(invoice.subtotal, invoice.currency)}
              </span>
            </div>
            {invoice.discount_amount > 0 && (
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{t("invoices.discount")}</span>
                <span className="tabular-nums">
                  -{formatCurrency(invoice.discount_amount, invoice.currency)}
                </span>
              </div>
            )}
            {invoice.tax_total > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("invoices.tax")}</span>
                <span className="tabular-nums">
                  {formatCurrency(invoice.tax_total, invoice.currency)}
                </span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-semibold text-lg">
              <span>{t("common.total")}</span>
              <span className="tabular-nums">
                {formatCurrency(invoice.total, invoice.currency)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment History */}
      <PaymentHistory
        invoiceId={id!}
        payments={payments}
        total={invoice.total}
        amountPaid={invoice.amount_paid || 0}
        currency={invoice.currency}
        onPaymentDeleted={fetchInvoice}
      />

      {/* Record Payment Dialog */}
      <RecordPaymentDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        invoiceId={id!}
        balanceDue={Math.max(0, invoice.total - (invoice.amount_paid || 0))}
        currency={invoice.currency}
        onSuccess={fetchInvoice}
      />

      {/* Linked Credit Notes */}
      {creditNotes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <ReceiptText className="h-4 w-4" /> {t("invoices.tab_credit_notes")} (
              {creditNotes.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {creditNotes.map((cn: any) => (
                <div
                  key={cn.id}
                  className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-accent/50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/invoices/${cn.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{cn.invoice_number}</span>
                    <Badge variant="secondary" className={STATUS_COLORS[cn.status]}>
                      {t(`invoices.status_${cn.status}`)}
                    </Badge>
                  </div>
                  <span className="text-sm font-medium tabular-nums text-red-600">
                    {formatCurrency(cn.total, cn.currency)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {invoice.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("invoices.notes")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{invoice.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Confirm Dialog (US4) */}
      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={confirmAction?.title || ""}
        description={confirmAction?.description || ""}
        confirmLabel={
          {
            delete: t("common.delete"),
            void: t("invoices.void"),
            unpublish: t("invoices.unpublish"),
          }[confirmAction?.type ?? ""] ?? t("common.confirm")
        }
        variant={
          confirmAction?.type === "delete" ||
          confirmAction?.type === "void" ||
          confirmAction?.type === "unpublish"
            ? "destructive"
            : "default"
        }
        onConfirm={executeAction}
        loading={actionLoading}
      />

      {/* Preview Dialog (US5) */}
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
              title="Invoice Preview"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Send Invoice Dialog */}
      <SendInvoiceDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        invoiceId={id!}
        customerEmail={invoice.customer?.email || null}
        invoiceNumber={invoice.invoice_number}
        onSuccess={fetchInvoice}
      />

      {/* Hidden iframe for printing */}
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
