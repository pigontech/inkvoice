import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
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
import { useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";
import { formatCurrency, formatDate } from "@/lib/utils";

interface Payment {
  id: string;
  amount: number;
  payment_date: string;
  method: string;
  reference: string | null;
  notes: string | null;
}

interface Props {
  invoiceId: string;
  payments: Payment[];
  total: number;
  amountPaid: number;
  currency: string;
  onPaymentDeleted: () => void;
}

export function PaymentHistory({
  invoiceId,
  payments,
  total,
  amountPaid,
  currency,
  onPaymentDeleted,
}: Props) {
  const { t } = useTranslation();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const balanceDue = total - amountPaid;

  const METHOD_LABELS: Record<string, string> = {
    bank_transfer: t("record_payment.method_bank"),
    cash: t("record_payment.method_cash"),
    card: t("record_payment.method_card"),
    check: t("record_payment.method_check"),
    other: t("record_payment.method_other"),
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await api.deletePayment(invoiceId, deleteId);
      toast.success(t("payment_history.deleted"));
      setDeleteId(null);
      onPaymentDeleted();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setDeleting(false);
    }
  };

  if (payments.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          <span>{t("payment_history.title")}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {t("payment_history.paid")} {formatCurrency(amountPaid, currency)} /{" "}
            {formatCurrency(total, currency)}
            {balanceDue > 0 && (
              <>
                {" "}
                &mdash; {t("payment_history.balance")} {formatCurrency(balanceDue, currency)}
              </>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("payment_history.date")}</TableHead>
              <TableHead>{t("payment_history.method")}</TableHead>
              <TableHead>{t("payment_history.reference")}</TableHead>
              <TableHead className="text-right">{t("payment_history.amount")}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="text-muted-foreground">
                  {formatDate(p.payment_date)}
                </TableCell>
                <TableCell>{METHOD_LABELS[p.method] || p.method}</TableCell>
                <TableCell className="text-muted-foreground">{p.reference || "-"}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {formatCurrency(p.amount, currency)}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={t("common.delete")}
                    onClick={() => setDeleteId(p.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        title={t("payment_history.delete_title")}
        description={t("payment_history.delete_description")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleting}
      />
    </Card>
  );
}
