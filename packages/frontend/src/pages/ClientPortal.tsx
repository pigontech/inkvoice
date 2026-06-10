import { Download, FileText, MessageSquare } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/i18n";
import { getPortalPayHandler } from "@/lib/portal-payment";
import { formatCurrency, formatDate } from "@/lib/utils";

interface PortalCustomer {
  name: string;
  email: string | null;
}

interface PortalInvoice {
  id: string;
  invoice_number: string;
  status: string;
  total: number;
  currency: string;
  issue_date: string;
  due_date: string | null;
}

const statusColors: Record<string, string> = {
  sent: "bg-blue-100 text-blue-800",
  paid: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
  partially_paid: "bg-yellow-100 text-yellow-800",
  voided: "bg-gray-100 text-gray-500",
  complete: "bg-green-100 text-green-800",
};

interface PortalComment {
  id: string;
  author_type: string;
  author_name: string;
  body: string;
  created_at: string;
}

export default function ClientPortal() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const [customer, setCustomer] = useState<PortalCustomer | null>(null);
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payingId, setPayingId] = useState<string | null>(null);
  const [openCommentsId, setOpenCommentsId] = useState<string | null>(null);
  const [commentsByInvoice, setCommentsByInvoice] = useState<Record<string, PortalComment[]>>({});
  const [draftComment, setDraftComment] = useState<Record<string, string>>({});
  const [postingId, setPostingId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await api.getPortalInvoices(token);
        if (!cancelled) {
          setCustomer(res.data.customer);
          setInvoices(res.data.invoices);
          setStripeEnabled(!!(res.data as any).stripe_enabled);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError(t("portal.portal_expired"));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, t]);

  // Group invoices by year for the "Download all year X" buttons.
  const years = useMemo(() => {
    const yearSet = new Set<number>();
    for (const inv of invoices) {
      const y = parseInt(inv.issue_date.slice(0, 4), 10);
      if (Number.isFinite(y)) yearSet.add(y);
    }
    return Array.from(yearSet).sort((a, b) => b - a);
  }, [invoices]);

  const toggleComments = async (invoiceId: string) => {
    if (!token) return;
    if (openCommentsId === invoiceId) {
      setOpenCommentsId(null);
      return;
    }
    setOpenCommentsId(invoiceId);
    if (!commentsByInvoice[invoiceId]) {
      try {
        const res = await api.getPortalInvoiceComments(token, invoiceId);
        setCommentsByInvoice((prev) => ({ ...prev, [invoiceId]: res.data }));
      } catch {
        // Leave undefined; UI shows empty state.
      }
    }
  };

  const submitComment = async (invoiceId: string) => {
    if (!token) return;
    const body = (draftComment[invoiceId] || "").trim();
    if (!body) return;
    setPostingId(invoiceId);
    try {
      const res = await api.postPortalInvoiceComment(token, invoiceId, body);
      setCommentsByInvoice((prev) => ({
        ...prev,
        [invoiceId]: [...(prev[invoiceId] || []), res.data],
      }));
      setDraftComment((prev) => ({ ...prev, [invoiceId]: "" }));
    } catch {
      // Silent — surface a toast in a future iteration if needed.
    } finally {
      setPostingId(null);
    }
  };

  const payHandler = getPortalPayHandler();

  const handlePay = async (invoice: PortalInvoice) => {
    if (!payHandler) return;
    setPayingId(invoice.id);
    try {
      const res = await payHandler({
        invoice_id: invoice.id,
        amount: invoice.total,
        currency: invoice.currency,
        description: `Invoice ${invoice.invoice_number}`,
      });
      if (res?.url) {
        window.location.href = res.url;
      }
    } catch {
      // Payment session creation failed silently
    } finally {
      setPayingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" role="status">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        <span className="sr-only">{t("common.loading")}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-muted-foreground">{error}</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between px-6 h-14 border-b bg-card">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          <span className="font-semibold">{t("portal.customer_portal")}</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto py-8 px-4">
        {customer && (
          <div className="mb-6">
            <h1 className="text-2xl font-bold">{customer.name}</h1>
            {customer.email && <p className="text-muted-foreground">{customer.email}</p>}
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t("portal.view_invoices")}</h2>
          {years.length > 0 && token && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">{t("portal.download_year")}:</span>
              {years.map((y) => (
                <a
                  key={y}
                  href={api.portalYearZipUrl(token, y)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-mono hover:bg-accent transition-colors"
                >
                  <Download className="h-3 w-3" />
                  {y}
                </a>
              ))}
            </div>
          )}
        </div>

        {invoices.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">{t("portal.no_invoices")}</div>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium">#</th>
                  <th className="text-left px-4 py-3 font-medium">{t("invoices.issue_date")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("invoices.due_date")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t("invoices.status")}</th>
                  <th className="text-right px-4 py-3 font-medium">{t("common.total")}</th>
                  <th className="text-right px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const open = openCommentsId === inv.id;
                  const comments = commentsByInvoice[inv.id] || [];
                  return (
                    <Fragment key={inv.id}>
                      <tr className="border-b last:border-b-0">
                        <td className="px-4 py-3 font-mono text-xs">{inv.invoice_number}</td>
                        <td className="px-4 py-3">{formatDate(inv.issue_date)}</td>
                        <td className="px-4 py-3">
                          {inv.due_date ? formatDate(inv.due_date) : "-"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[inv.status] || "bg-gray-100 text-gray-800"}`}
                          >
                            {inv.status.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {formatCurrency(inv.total, inv.currency)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-2 justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => toggleComments(inv.id)}
                              aria-expanded={open}
                              aria-controls={`comments-${inv.id}`}
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              {comments.length > 0 ? comments.length : t("portal.ask_question")}
                            </Button>
                            {stripeEnabled &&
                              payHandler &&
                              ["sent", "overdue", "partially_paid"].includes(inv.status) && (
                                <Button
                                  size="sm"
                                  onClick={() => handlePay(inv)}
                                  disabled={payingId === inv.id}
                                >
                                  {payingId === inv.id
                                    ? t("public.redirecting")
                                    : t("portal.pay_now")}
                                </Button>
                              )}
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr
                          id={`comments-${inv.id}`}
                          className="bg-muted/30 border-b last:border-b-0"
                        >
                          <td colSpan={6} className="px-4 py-4">
                            <div className="space-y-3 max-w-2xl">
                              {comments.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  {t("portal.no_comments")}
                                </p>
                              ) : (
                                <ul className="space-y-2">
                                  {comments.map((c) => (
                                    <li
                                      key={c.id}
                                      className={`rounded-md p-3 text-sm ${
                                        c.author_type === "staff"
                                          ? "bg-primary/5 border border-primary/20"
                                          : "bg-card border"
                                      }`}
                                    >
                                      <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-medium">
                                          {c.author_name}
                                          <span className="text-muted-foreground ml-1.5">
                                            ·{" "}
                                            {c.author_type === "staff"
                                              ? t("portal.staff")
                                              : t("portal.you")}
                                          </span>
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                          {formatDate(c.created_at)}
                                        </span>
                                      </div>
                                      <p className="whitespace-pre-wrap">{c.body}</p>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              <div className="space-y-2">
                                <Textarea
                                  rows={2}
                                  value={draftComment[inv.id] || ""}
                                  onChange={(e) =>
                                    setDraftComment((prev) => ({
                                      ...prev,
                                      [inv.id]: e.target.value,
                                    }))
                                  }
                                  placeholder={t("portal.comment_placeholder")}
                                  maxLength={4000}
                                />
                                <div className="flex justify-end">
                                  <Button
                                    size="sm"
                                    onClick={() => submitComment(inv.id)}
                                    disabled={
                                      postingId === inv.id || !(draftComment[inv.id] || "").trim()
                                    }
                                  >
                                    {postingId === inv.id ? t("common.saving") : t("portal.send")}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
