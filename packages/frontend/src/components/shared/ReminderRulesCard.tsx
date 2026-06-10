import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";

interface ReminderRule {
  id: string;
  name: string;
  days_offset: number;
  type: "before_due" | "on_due" | "after_due";
  email_subject: string;
  email_body: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

const DEFAULT_BODY = `Hi {{customer_name}},

Just a quick reminder that invoice {{invoice_number}} for {{amount_due}} is due on {{due_date}}.

Thanks!`;

export function ReminderRulesCard() {
  const { t } = useTranslation();
  const [rules, setRules] = useState<ReminderRule[]>([]);
  const [editing, setEditing] = useState<ReminderRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    try {
      const res = await api.listReminderRules();
      setRules(res.data ?? []);
    } catch (err) {
      toast.error(formatApiError(err, t));
    }
  }, [t]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleSave = async (data: Omit<ReminderRule, "id" | "created_at" | "updated_at">) => {
    try {
      if (editing) {
        await api.updateReminderRule(editing.id, data);
        toast.success(t("reminder_rules.updated"));
      } else {
        await api.createReminderRule(data);
        toast.success(t("reminder_rules.created"));
      }
      await fetchRules();
      setEditing(null);
      setCreating(false);
    } catch (err) {
      toast.error(formatApiError(err, t));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteReminderRule(id);
      toast.success(t("reminder_rules.deleted"));
      await fetchRules();
    } catch (err) {
      toast.error(formatApiError(err, t));
    } finally {
      setDeletingId(null);
    }
  };

  const offsetLabel = (rule: ReminderRule): string => {
    if (rule.type === "on_due") return t("reminder_rules.on_due");
    if (rule.type === "before_due") {
      return t("reminder_rules.days_before_due", { days: String(rule.days_offset) });
    }
    return t("reminder_rules.days_after_due", { days: String(rule.days_offset) });
  };

  return (
    <>
      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">{t("reminder_rules.title")}</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> {t("reminder_rules.add")}
          </Button>
        </CardHeader>
        <CardContent>
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("reminder_rules.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-md border border-border bg-background/50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{rule.name}</span>
                      {!rule.is_active && (
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground border border-border rounded px-1 py-0.5">
                          {t("common.inactive")}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {offsetLabel(rule)} · {rule.email_subject}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setEditing(rule)}
                      aria-label={t("common.edit")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setDeletingId(rule.id)}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {(creating || editing) && (
        <ReminderRuleDialog
          rule={editing}
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
        title={t("reminder_rules.confirm_delete_title")}
        description={t("reminder_rules.confirm_delete_body")}
        variant="destructive"
        confirmLabel={t("common.delete")}
        onConfirm={() => {
          if (deletingId) handleDelete(deletingId);
        }}
      />
    </>
  );
}

function ReminderRuleDialog({
  rule,
  open,
  onOpenChange,
  onSave,
}: {
  rule: ReminderRule | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSave: (data: Omit<ReminderRule, "id" | "created_at" | "updated_at">) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(rule?.name ?? "");
  const [type, setType] = useState<"before_due" | "on_due" | "after_due">(
    rule?.type ?? "before_due",
  );
  const [days, setDays] = useState<number>(rule?.days_offset ?? 7);
  const [subject, setSubject] = useState(
    rule?.email_subject ?? t("reminder_rules.default_subject"),
  );
  const [body, setBody] = useState(rule?.email_body ?? DEFAULT_BODY);
  const [active, setActive] = useState<boolean>(rule ? !!rule.is_active : true);

  useEffect(() => {
    setName(rule?.name ?? "");
    setType(rule?.type ?? "before_due");
    setDays(rule?.days_offset ?? 7);
    setSubject(rule?.email_subject ?? t("reminder_rules.default_subject"));
    setBody(rule?.email_body ?? DEFAULT_BODY);
    setActive(rule ? !!rule.is_active : true);
  }, [rule, t]);

  const submit = () => {
    if (!name.trim() || !subject.trim() || !body.trim()) return;
    void onSave({
      name: name.trim(),
      type,
      days_offset: type === "on_due" ? 0 : Math.max(1, Math.floor(days || 1)),
      email_subject: subject.trim(),
      email_body: body,
      is_active: active ? 1 : 0,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {rule ? t("reminder_rules.edit_title") : t("reminder_rules.add_title")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label={t("reminder_rules.field_name")}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("reminder_rules.name_placeholder")}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("reminder_rules.field_when")}>
              <select
                className="form-select"
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
              >
                <option value="before_due">{t("reminder_rules.before_due")}</option>
                <option value="on_due">{t("reminder_rules.on_due")}</option>
                <option value="after_due">{t("reminder_rules.after_due")}</option>
              </select>
            </FormField>
            {type !== "on_due" && (
              <FormField label={t("reminder_rules.field_days")}>
                <NumberInput value={days} min={1} integer onValueChange={(v) => setDays(v ?? 1)} />
              </FormField>
            )}
          </div>
          <FormField label={t("reminder_rules.field_subject")}>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </FormField>
          <FormField label={t("reminder_rules.field_body")}>
            <Textarea
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="font-mono text-xs"
            />
          </FormField>
          <p className="text-[11px] text-muted-foreground">{t("reminder_rules.variables_hint")}</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="rounded"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            {t("reminder_rules.field_active")}
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!name.trim() || !subject.trim() || !body.trim()}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
