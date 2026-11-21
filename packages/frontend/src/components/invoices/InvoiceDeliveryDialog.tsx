import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCan } from "@/hooks/use-can";
import { useTranslation } from "@/i18n";
import { allBankingOptions } from "@/lib/banking-options";
import { formatApiError } from "@/lib/format-api-error";
import type {
  Contact,
  DeliveryInput,
  DeliveryMessage,
  InvoiceDelivery,
  PaymentDetails,
} from "../../../../backend/src/contracts/banking";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
  customerEmail: string | null;
  invoiceStatus: string;
  paymentDetails?: PaymentDetails;
  onSuccess: () => void;
}
export function InvoiceDeliveryPanel(props: Props) {
  const { t } = useTranslation();
  const can = useCan();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Record<string, "private" | "cc">>({});
  const [kind, setKind] = useState<"customer" | "private">("customer");
  const [to, setTo] = useState(props.customerEmail || "");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [from, setFrom] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<InvoiceDelivery[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [revision, setRevision] = useState(0);
  const [retry, setRetry] = useState<Pick<
    DeliveryMessage,
    "recipients" | "rejected" | "state"
  > | null>(null);
  const intent = useRef<{ payload: string; key: string } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh token explicitly reloads sending history.
  useEffect(() => {
    let active = true;
    api
      .invoiceDeliveries(props.invoiceId, page)
      .then((r) => {
        if (active) {
          setHistory(r.data.items);
          setPages(r.data.totalPages);
          setHistoryError("");
        }
      })
      .catch((err) => {
        if (active) setHistoryError(formatApiError(err, t));
      });
    return () => {
      active = false;
    };
  }, [props.invoiceId, page, revision, t]);
  useEffect(() => {
    if (!props.open) return;
    let active = true;
    setError("");
    setLoadingContacts(true);
    allBankingOptions((p) => api.listContacts({ page: String(p), limit: "100", archived: "false" }))
      .then((items) => {
        if (active)
          setContacts(
            items.sort(
              (a, b) =>
                Number(b.bank_id === props.paymentDetails?.bank_id) -
                Number(a.bank_id === props.paymentDetails?.bank_id),
            ),
          );
      })
      .catch((err) => {
        if (active) setError(formatApiError(err, t));
      })
      .finally(() => {
        if (active) setLoadingContacts(false);
      });
    return () => {
      active = false;
    };
  }, [props.open, props.paymentDetails?.bank_id, t]);
  useEffect(() => {
    if (!props.open) return;
    const failures = retry
      ? retry.recipients.filter(
          (r) =>
            retry.state === "failed" ||
            retry.rejected.some((email) => email.toLowerCase() === r.email.toLowerCase()),
        )
      : [];
    const customer = failures.find((r) => r.mode === "to");
    setKind(retry && !customer ? "private" : "customer");
    setTo(customer?.email || props.customerEmail || "");
    setSelected(
      Object.fromEntries(
        failures
          .filter((r) => r.contact_id)
          .map((r) => [r.contact_id!, customer && r.mode === "cc" ? "cc" : "private"]),
      ),
    );
    setSubject("");
    setMessage("");
    setFrom("");
    setReplyTo("");
  }, [props.open, props.customerEmail, retry]);
  const close = (open: boolean) => {
    if (busy) return;
    props.onOpenChange(open);
    if (!open) {
      setRetry(null);
      setSelected({});
    }
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const common = {
      subject: subject || undefined,
      message: message || undefined,
      from: from || undefined,
      reply_to: replyTo || undefined,
    };
    const payload: DeliveryInput =
      kind === "customer"
        ? {
            kind,
            to,
            recipients: Object.entries(selected).map(([contact_id, mode]) => ({
              contact_id,
              mode,
            })),
            ...common,
          }
        : {
            kind,
            recipients: Object.keys(selected).map((contact_id) => ({
              contact_id,
              mode: "private" as const,
            })),
            ...common,
          };
    const encoded = JSON.stringify(payload);
    if (intent.current?.payload !== encoded)
      intent.current = { payload: encoded, key: crypto.randomUUID() };
    try {
      const r = await api.deliverInvoice(props.invoiceId, payload, intent.current.key);
      setRevision((n) => n + 1);
      setPage(1);
      props.onSuccess();
      if (r.data.messages.every((m) => m.state === "accepted" && !m.rejected.length))
        toast.success(t("banking.accepted_notice"));
      else toast.warning(t("banking.check_history"));
      props.onOpenChange(false);
      setRetry(null);
      setSelected({});
      intent.current = null;
    } catch (err) {
      setError(formatApiError(err, t));
      setRevision((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("banking.receiving_account")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-line text-sm">
            {props.paymentDetails?.bank_details || t("common.none")}
          </p>
          {props.invoiceStatus !== "draft" && (
            <p className="mt-2 text-xs text-muted-foreground">{t("banking.frozen")}</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("banking.history")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("banking.history_hint")}</p>
          {historyError && (
            <p role="alert" className="text-destructive">
              {historyError}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setRevision((n) => n + 1)}>
              {t("banking.refresh")}
            </Button>
            {can("invoices", "publish") &&
              props.invoiceStatus !== "draft" &&
              props.invoiceStatus !== "voided" && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setRetry({ recipients: [], rejected: [], state: "failed" });
                    props.onOpenChange(true);
                  }}
                >
                  {t("banking.share_private")}
                </Button>
              )}
          </div>
          {!history.length && (
            <p className="text-muted-foreground text-sm">{t("banking.no_history")}</p>
          )}
          {history.flatMap((request) =>
            request.messages.map((entry) => (
              <div key={entry.id} className="border rounded-lg p-3 space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span>
                    {t(`banking.${entry.kind === "customer" ? "customer_email" : "private_copy"}`)}
                  </span>
                  <span>{t(`banking.${entry.state}`)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{request.created_at} UTC</p>
                {entry.recipients.map((recipient) => (
                  <p key={recipient.email} className="break-all">
                    {recipient.name} · {recipient.email} · {recipient.mode.toUpperCase()}
                    {entry.rejected.some(
                      (email) => email.toLowerCase() === recipient.email.toLowerCase(),
                    )
                      ? ` · ${t("banking.failed")}`
                      : ""}
                  </p>
                ))}
                {entry.error && <p className="text-destructive">{entry.error}</p>}
                {entry.state === "unknown" && <p>{t("banking.unknown_hint")}</p>}
                {can("invoices", "publish") &&
                  (entry.state === "failed" || entry.rejected.length > 0) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRetry(entry);
                        props.onOpenChange(true);
                      }}
                    >
                      {t("banking.prepare_retry")}
                    </Button>
                  )}
              </div>
            )),
          )}
          {pages > 1 && (
            <div className="flex gap-3">
              <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t("banking.previous")}
              </Button>
              <span>
                {page} / {pages}
              </span>
              <Button
                variant="outline"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("banking.next")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog open={props.open} onOpenChange={close}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t("send_dialog.send_invoice", { number: props.invoiceNumber })}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <FormField label={t("banking.delivery_type")}>
              <select
                className="form-select"
                value={kind}
                disabled={busy}
                onChange={(e) => {
                  setKind(e.target.value as "customer" | "private");
                  setSelected((current) =>
                    Object.fromEntries(Object.keys(current).map((id) => [id, "private"])),
                  );
                }}
              >
                <option value="customer">{t("banking.customer_email")}</option>
                <option value="private" disabled={props.invoiceStatus === "draft"}>
                  {t("banking.private_only")}
                </option>
              </select>
            </FormField>
            {kind === "customer" && (
              <FormField label={t("send_dialog.to")} required>
                <Input
                  type="email"
                  required
                  value={to}
                  disabled={busy}
                  onChange={(e) => setTo(e.target.value)}
                />
              </FormField>
            )}
            <fieldset className="space-y-2" disabled={busy || loadingContacts}>
              <legend className="text-sm font-medium">{t("banking.saved_recipients")}</legend>
              <p className="text-xs text-muted-foreground">{t("banking.recipient_hint")}</p>
              {loadingContacts ? (
                <p role="status">{t("common.loading")}</p>
              ) : !contacts.length ? (
                <p className="text-sm">{t("banking.no_contacts")}</p>
              ) : (
                contacts.map((contact) => (
                  <div key={contact.id} className="border rounded-lg p-2 space-y-2">
                    <label className="flex gap-2 items-start text-sm">
                      <input
                        type="checkbox"
                        checked={!!selected[contact.id]}
                        onChange={(e) =>
                          setSelected((current) => {
                            const next = { ...current };
                            if (e.target.checked) next[contact.id] = "private";
                            else delete next[contact.id];
                            return next;
                          })
                        }
                      />
                      <span>
                        {contact.name}
                        <span className="block break-all text-muted-foreground">
                          {contact.email}
                          {contact.bank_name ? ` · ${contact.bank_name}` : ""}
                        </span>
                      </span>
                    </label>
                    {selected[contact.id] && kind === "customer" && (
                      <select
                        aria-label={`${contact.name}: ${t("banking.delivery_type")}`}
                        className="form-select"
                        value={selected[contact.id]}
                        onChange={(e) =>
                          setSelected((current) => ({
                            ...current,
                            [contact.id]: e.target.value as "private" | "cc",
                          }))
                        }
                      >
                        <option value="private">{t("banking.private_copy")}</option>
                        <option value="cc">{t("banking.cc_customer")}</option>
                      </select>
                    )}
                  </div>
                ))
              )}
            </fieldset>
            {Object.values(selected).includes("cc") && (
              <p className="text-sm">{t("banking.cc_hint")}</p>
            )}
            {(kind === "private" || Object.values(selected).includes("private")) && (
              <p className="text-sm text-muted-foreground">{t("banking.private_hint")}</p>
            )}
            <FormField label={t("send_dialog.subject")}>
              <Input value={subject} disabled={busy} onChange={(e) => setSubject(e.target.value)} />
            </FormField>
            <FormField label={t("send_dialog.message")}>
              <Textarea
                value={message}
                disabled={busy}
                onChange={(e) => setMessage(e.target.value)}
              />
            </FormField>
            <details>
              <summary className="cursor-pointer text-sm">{t("send_dialog.advanced")}</summary>
              <div className="space-y-3 mt-3">
                <FormField label={t("send_dialog.from")}>
                  <Input
                    type="email"
                    value={from}
                    disabled={busy}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </FormField>
                <FormField label={t("send_dialog.reply_to")}>
                  <Input
                    type="email"
                    value={replyTo}
                    disabled={busy}
                    onChange={(e) => setReplyTo(e.target.value)}
                  />
                </FormField>
              </div>
            </details>
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" disabled={busy} onClick={() => close(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  busy || loadingContacts || (kind === "private" && !Object.keys(selected).length)
                }
              >
                {busy ? t("common.loading") : t("send_dialog.send")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
