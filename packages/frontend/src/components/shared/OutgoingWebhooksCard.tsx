import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";
import { formatRelativeTime } from "@/lib/format-relative";

interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string;
  preset: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface Delivery {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: string | null;
  status_code: number | null;
  response_body: string | null;
  error_message: string | null;
  attempt_count: number;
  created_at: string;
}

const SLACK_HINT = "https://hooks.slack.com/services/T…/B…/…";

function parseEvents(s: string): string[] {
  try {
    return JSON.parse(s) as string[];
  } catch {
    return [];
  }
}

export function OutgoingWebhooksCard() {
  const { t } = useTranslation();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchWebhooks = useCallback(async () => {
    try {
      const [list, ev] = await Promise.all([
        api.listOutgoingWebhooks(),
        api.listOutgoingWebhookEvents(),
      ]);
      setWebhooks(list.data ?? []);
      setAvailableEvents(ev.data?.events ?? []);
    } catch (err) {
      toast.error(formatApiError(err, t));
    }
  }, [t]);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  const handleSave = async (data: {
    name: string;
    url: string;
    events: string[];
    preset: string;
    is_active: boolean;
  }) => {
    try {
      if (editing) {
        await api.updateOutgoingWebhook(editing.id, data);
        toast.success(t("webhooks.updated"));
      } else {
        await api.createOutgoingWebhook(data);
        toast.success(t("webhooks.created"));
      }
      await fetchWebhooks();
      setEditing(null);
      setCreating(false);
    } catch (err) {
      toast.error(formatApiError(err, t));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteOutgoingWebhook(id);
      toast.success(t("webhooks.deleted"));
      await fetchWebhooks();
    } catch (err) {
      toast.error(formatApiError(err, t));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">{t("webhooks.title")}</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> {t("webhooks.add")}
          </Button>
        </CardHeader>
        <CardContent>
          {webhooks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("webhooks.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {webhooks.map((w) => (
                <li
                  key={w.id}
                  className="rounded-md border border-border bg-background/50 overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-3 p-3">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === w.id ? null : w.id)}
                      className="flex items-start gap-2 flex-1 min-w-0 text-left"
                      aria-expanded={expandedId === w.id}
                    >
                      {expandedId === w.id ? (
                        <ChevronDown className="h-4 w-4 mt-0.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 mt-0.5 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">{w.name}</span>
                          {w.preset === "slack" && (
                            <span className="text-[10px] uppercase tracking-wider rounded bg-purple-500/10 text-purple-600 dark:text-purple-300 px-1.5 py-0.5">
                              Slack
                            </span>
                          )}
                          {!w.is_active && (
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground border border-border rounded px-1 py-0.5">
                              {t("common.inactive")}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate font-mono">
                          {w.url}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {parseEvents(w.events).join(", ") || t("webhooks.no_events")}
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setEditing(w)}
                        aria-label={t("common.edit")}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setDeletingId(w.id)}
                        aria-label={t("common.delete")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {expandedId === w.id && <DeliveryList webhookId={w.id} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {(creating || editing) && (
        <WebhookDialog
          webhook={editing}
          availableEvents={availableEvents}
          open={creating || editing !== null}
          onOpenChange={(o) => {
            if (!o) {
              setCreating(false);
              setEditing(null);
            }
          }}
          onSave={handleSave}
        />
      )}

      <ConfirmDialog
        open={deletingId !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingId(null);
        }}
        title={t("webhooks.confirm_delete_title")}
        description={t("webhooks.confirm_delete_body")}
        variant="destructive"
        confirmLabel={t("common.delete")}
        onConfirm={() => {
          if (deletingId) handleDelete(deletingId);
        }}
      />
    </>
  );
}

function DeliveryList({ webhookId }: { webhookId: string }) {
  const { t } = useTranslation();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      const res = await api.listWebhookDeliveries(webhookId, 25);
      setDeliveries(res.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [webhookId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      await api.retryWebhookDelivery(id);
      await fetch();
      toast.success(t("webhooks.delivery_retried"));
    } catch (err) {
      toast.error(formatApiError(err, t));
    } finally {
      setRetrying(null);
    }
  };

  return (
    <div className="border-t border-border bg-muted/30 p-3 max-h-72 overflow-auto">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        {t("webhooks.recent_deliveries")}
      </div>
      {loading ? (
        <div className="text-xs text-muted-foreground">{t("common.loading")}</div>
      ) : deliveries.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t("webhooks.no_deliveries")}</div>
      ) : (
        <ul className="space-y-1">
          {deliveries.map((d) => {
            const ok = d.status_code !== null && d.status_code >= 200 && d.status_code < 300;
            return (
              <li
                key={d.id}
                className="flex items-center gap-2 text-xs py-1 border-b border-border/50 last:border-b-0"
              >
                {ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                )}
                <span className="font-mono tabular-nums w-12 shrink-0">{d.status_code ?? "—"}</span>
                <span className="font-medium w-32 truncate">{d.event_type}</span>
                <span className="text-muted-foreground flex-1 truncate">
                  {d.error_message || d.response_body?.slice(0, 80) || "OK"}
                </span>
                <span className="text-muted-foreground shrink-0">
                  {formatRelativeTime(new Date(d.created_at).getTime(), t)}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-6 w-6 shrink-0"
                  disabled={retrying === d.id}
                  onClick={() => retry(d.id)}
                  aria-label={t("webhooks.retry")}
                >
                  <RotateCcw className="h-3 w-3" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function WebhookDialog({
  webhook,
  availableEvents,
  open,
  onOpenChange,
  onSave,
}: {
  webhook: Webhook | null;
  availableEvents: string[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (data: {
    name: string;
    url: string;
    events: string[];
    preset: string;
    is_active: boolean;
  }) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(webhook?.name ?? "");
  const [url, setUrl] = useState(webhook?.url ?? "");
  const [preset, setPreset] = useState(webhook?.preset ?? "generic");
  const [active, setActive] = useState(webhook ? !!webhook.is_active : true);
  const [events, setEvents] = useState<string[]>(
    webhook ? parseEvents(webhook.events) : ["invoice.paid"],
  );

  useEffect(() => {
    setName(webhook?.name ?? "");
    setUrl(webhook?.url ?? "");
    setPreset(webhook?.preset ?? "generic");
    setActive(webhook ? !!webhook.is_active : true);
    setEvents(webhook ? parseEvents(webhook.events) : ["invoice.paid"]);
  }, [webhook]);

  const toggleEvent = (e: string) => {
    setEvents((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));
  };

  const submit = () => {
    if (!name.trim() || !url.trim() || events.length === 0) return;
    void onSave({ name: name.trim(), url: url.trim(), events, preset, is_active: active });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{webhook ? t("webhooks.edit_title") : t("webhooks.add_title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label={t("webhooks.field_name")}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("webhooks.name_placeholder")}
            />
          </FormField>
          <FormField label={t("webhooks.field_preset")}>
            <select
              className="form-select"
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value);
                if (e.target.value === "slack" && !url) setUrl(SLACK_HINT);
              }}
            >
              <option value="generic">{t("webhooks.preset_generic")}</option>
              <option value="slack">{t("webhooks.preset_slack")}</option>
            </select>
          </FormField>
          <FormField
            label={t("webhooks.field_url")}
            hint={preset === "slack" ? t("webhooks.slack_url_hint") : t("webhooks.url_hint")}
          >
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={preset === "slack" ? SLACK_HINT : "https://example.com/webhook"}
            />
          </FormField>
          <FormField label={t("webhooks.field_events")}>
            <div className="flex flex-wrap gap-2">
              {availableEvents.map((e) => (
                <label
                  key={e}
                  className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border cursor-pointer ${
                    events.includes(e)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-3 w-3"
                    checked={events.includes(e)}
                    onChange={() => toggleEvent(e)}
                  />
                  {e}
                </label>
              ))}
            </div>
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="rounded"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            {t("webhooks.field_active")}
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!name.trim() || !url.trim() || events.length === 0}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
