import { Download, FileCode2, FileText, Loader2, RefreshCw, Trash2, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCan } from "@/hooks/use-can";
import { useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";
import { formatDate } from "@/lib/utils";

interface Props {
  invoiceId: string;
  /** A draft has a placeholder number, so the e-invoice waits until it is sent. */
  draft?: boolean;
}

interface EinvoiceRecord {
  id: string;
  format: string;
  hash: string;
  created_at: string;
  has_xml: number;
  has_pdf: number;
}

const FORMAT_LABELS: Record<string, string> = {
  zugferd: "ZUGFeRD (EN 16931)",
  "xrechnung-ubl": "XRechnung 3.0",
  "xrechnung-cii": "XRechnung CII",
  peppol: "PEPPOL BIS 3.0",
};

function EinvoicePanel({ invoiceId, draft = false }: Props) {
  const { t } = useTranslation();
  const can = useCan();
  const [records, setRecords] = useState<EinvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [emitting, setEmitting] = useState(false);
  const [deleting, setDeleting] = useState<EinvoiceRecord | null>(null);
  // Issues from the last emit, so the user sees what to fix.
  const [issues, setIssues] = useState<{ severity: string; code: string; message: string }[]>([]);

  const load = useCallback(() => {
    api.listEinvoiceRecords(invoiceId).then((r) => {
      setRecords(r.data || []);
      setLoading(false);
    });
  }, [invoiceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function emit() {
    setEmitting(true);
    try {
      const r = await api.emitEinvoice(invoiceId);
      if (!r.success) throw new Error("emit failed");
      const found: { severity: string; code: string; message: string }[] = r.data?.issues || [];
      setIssues(found);
      const errors = found.filter((i) => i.severity === "error");
      if (errors.length) {
        toast.warning(t("einvoice.emit_with_issues", { count: String(errors.length) }));
      }
      toast.success(
        t("einvoice.emit_success", { format: FORMAT_LABELS[r.data?.format] || r.data?.format }),
      );
      load();
    } catch (err) {
      toast.error(formatApiError(err, t));
    } finally {
      setEmitting(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    try {
      await api.deleteEinvoiceRecord(invoiceId, deleting.id);
      toast.success(t("einvoice.record_deleted"));
      load();
    } catch (err) {
      toast.error(formatApiError(err, t));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t("einvoice.title")}</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {can("invoices", "publish") && (
            <Button size="sm" onClick={emit} disabled={emitting || draft}>
              {emitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              {t("einvoice.emit")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {draft && <p className="mb-3 text-sm text-muted-foreground">{t("einvoice.draft_hint")}</p>}
        {issues.length > 0 && (
          <div className="mb-4 rounded-md border p-3 text-sm">
            <p className="font-medium mb-1">{t("einvoice.issues_title")}</p>
            <ul className="space-y-1">
              {issues.map((issue) => (
                <li
                  key={issue.code}
                  className={
                    issue.severity === "error"
                      ? "text-destructive"
                      : "text-amber-600 dark:text-amber-400"
                  }
                >
                  {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("einvoice.loading")}</p>
        ) : records.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("einvoice.no_records")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("einvoice.format")}</TableHead>
                <TableHead>{t("einvoice.emitted_at")}</TableHead>
                <TableHead className="w-40">{t("einvoice.download")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((rec) => (
                <TableRow key={rec.id}>
                  <TableCell>
                    <Badge variant="secondary">{FORMAT_LABELS[rec.format] || rec.format}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums text-sm">
                    {formatDate(rec.created_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1.5">
                      <a
                        href={api.downloadEinvoiceXml(invoiceId, rec.id)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-input px-2 text-xs"
                        title={t("einvoice.download_xml")}
                      >
                        <FileCode2 className="h-3.5 w-3.5" />
                        XML
                      </a>
                      {rec.has_pdf === 1 && (
                        <a
                          href={api.downloadEinvoicePdf(invoiceId, rec.id)}
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-input px-2 text-xs"
                          title={t("einvoice.download_pdf")}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          <Download className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {can("invoices", "delete") && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setDeleting(rec)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={remove}
        title={t("einvoice.delete_record")}
        description={t("einvoice.delete_record_desc")}
      />
    </Card>
  );
}

export { EinvoicePanel };
