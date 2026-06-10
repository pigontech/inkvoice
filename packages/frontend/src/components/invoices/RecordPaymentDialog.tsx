import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/i18n";
import { todayIso } from "@/lib/date";
import { formatApiError } from "@/lib/format-api-error";
import { formatCurrency } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  balanceDue: number;
  currency: string;
  onSuccess: () => void;
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  invoiceId,
  balanceDue,
  currency,
  onSuccess,
}: Props) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(balanceDue);
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(balanceDue);
      setPaymentDate(todayIso());
      setReference("");
      setNotes("");
    }
  }, [open, balanceDue]);

  const handleSubmit = async () => {
    if (!amount || amount <= 0) {
      toast.error(t("record_payment.amount_error"));
      return;
    }
    setLoading(true);
    try {
      await api.recordPayment(invoiceId, {
        amount,
        payment_date: paymentDate,
        method,
        reference: reference || undefined,
        notes: notes || undefined,
      });
      toast.success(t("record_payment.recorded"));
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
          <DialogTitle>{t("record_payment.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <FormField
            label={t("record_payment.amount")}
            hint={t("record_payment.balance_due", { amount: formatCurrency(balanceDue, currency) })}
          >
            <NumberInput value={amount} min={0.01} decimals={2} onValueChange={setAmount} />
            {amount > balanceDue && (
              <p className="text-xs text-amber-600 mt-1">{t("record_payment.exceeds_balance")}</p>
            )}
          </FormField>
          <FormField label={t("record_payment.payment_date")}>
            <Input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </FormField>
          <FormField label={t("record_payment.method")}>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="form-select"
            >
              <option value="bank_transfer">{t("record_payment.method_bank")}</option>
              <option value="cash">{t("record_payment.method_cash")}</option>
              <option value="card">{t("record_payment.method_card")}</option>
              <option value="check">{t("record_payment.method_check")}</option>
              <option value="other">{t("record_payment.method_other")}</option>
            </select>
          </FormField>
          <FormField label={t("record_payment.reference")}>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t("common.optional")}
            />
          </FormField>
          <FormField label={t("record_payment.notes")}>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={t("common.optional")}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            {t("record_payment.record")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
