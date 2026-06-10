import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
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

interface ApiToken {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
}

export function ApiTokensCard() {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [resources, setResources] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    try {
      const [list, scopes] = await Promise.all([api.listApiTokens(), api.listApiTokenScopes()]);
      setTokens(list.data ?? []);
      setResources(scopes.data?.resources ?? []);
      setActions(scopes.data?.actions ?? []);
    } catch (err) {
      toast.error(formatApiError(err, t));
    }
  }, [t]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const handleCreate = async (data: { name: string; scopes: string[] }) => {
    try {
      const res = await api.createApiToken(data);
      setCreating(false);
      setRevealed(res.data.token);
      await fetchTokens();
    } catch (err) {
      toast.error(formatApiError(err, t));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteApiToken(id);
      toast.success(t("api_tokens.revoked"));
      await fetchTokens();
    } catch (err) {
      toast.error(formatApiError(err, t));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <Card className="mt-4">
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-sm">{t("api_tokens.title")}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">{t("api_tokens.info")}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> {t("api_tokens.generate")}
          </Button>
        </CardHeader>
        <CardContent>
          {tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("api_tokens.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {tokens.map((tk) => (
                <li
                  key={tk.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/50 p-3"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <KeyRound className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{tk.name}</span>
                        <span className="text-xs text-muted-foreground font-mono">
                          {tk.token_prefix}…
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {tk.scopes.length === 0
                          ? t("api_tokens.full_access")
                          : tk.scopes.join(", ")}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {tk.last_used_at
                          ? t("api_tokens.last_used", {
                              time: formatRelativeTime(new Date(tk.last_used_at).getTime(), t),
                            })
                          : t("api_tokens.never_used")}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => setDeletingId(tk.id)}
                    aria-label={t("common.delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {creating && (
        <CreateTokenDialog
          open={creating}
          resources={resources}
          actions={actions}
          onOpenChange={setCreating}
          onCreate={handleCreate}
        />
      )}

      <RevealTokenDialog token={revealed} onClose={() => setRevealed(null)} />

      <ConfirmDialog
        open={deletingId !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingId(null);
        }}
        title={t("api_tokens.confirm_delete_title")}
        description={t("api_tokens.confirm_delete_body")}
        variant="destructive"
        confirmLabel={t("common.delete")}
        onConfirm={() => {
          if (deletingId) handleDelete(deletingId);
        }}
      />
    </>
  );
}

function CreateTokenDialog({
  open,
  resources,
  actions,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  resources: string[];
  actions: string[];
  onOpenChange: (o: boolean) => void;
  onCreate: (data: { name: string; scopes: string[] }) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [fullAccess, setFullAccess] = useState(true);
  const [scopes, setScopes] = useState<Set<string>>(new Set());

  const toggleScope = (scope: string) => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const submit = () => {
    if (!name.trim()) return;
    void onCreate({
      name: name.trim(),
      scopes: fullAccess ? [] : [...scopes],
    });
  };

  const valid = name.trim() !== "" && (fullAccess || scopes.size > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("api_tokens.generate_title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label={t("api_tokens.name")}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("api_tokens.name_placeholder")}
            />
          </FormField>

          <FormField label={t("api_tokens.scopes")}>
            <label className="flex items-center gap-2 text-sm mb-2">
              <input
                type="checkbox"
                className="rounded"
                checked={fullAccess}
                onChange={(e) => setFullAccess(e.target.checked)}
              />
              <span>
                {t("api_tokens.full_access")}
                <span className="text-muted-foreground"> — {t("api_tokens.full_access_hint")}</span>
              </span>
            </label>

            {!fullAccess && (
              <div className="rounded-md border border-border divide-y divide-border">
                {resources.map((r) => (
                  <div key={r} className="flex items-center justify-between px-3 py-2">
                    <span className="text-sm capitalize">{r}</span>
                    <div className="flex items-center gap-3">
                      {actions.map((a) => (
                        <label
                          key={a}
                          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                        >
                          <input
                            type="checkbox"
                            className="h-3 w-3"
                            checked={scopes.has(`${r}:${a}`)}
                            onChange={() => toggleScope(`${r}:${a}`)}
                          />
                          {a === "read" ? t("api_tokens.scope_read") : t("api_tokens.scope_write")}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!valid}>
            {t("api_tokens.generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevealTokenDialog({ token, onClose }: { token: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(formatApiError(new Error("clipboard"), t));
    }
  };

  return (
    <Dialog
      open={token !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("api_tokens.reveal_title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-amber-600 dark:text-amber-400">
            {t("api_tokens.reveal_warning")}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate rounded-md border border-border bg-muted px-3 py-2 text-xs font-mono">
              {token}
            </code>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 mr-1.5" /> {t("api_tokens.copied")}
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 mr-1.5" /> {t("api_tokens.copy")}
                </>
              )}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t("api_tokens.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
