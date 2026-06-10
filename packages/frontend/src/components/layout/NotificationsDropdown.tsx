import { Bell, Check } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useTranslation } from "@/i18n";
import { formatRelativeTime } from "@/lib/format-relative";

interface ActivityItem {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: string | null;
  created_at: string;
}

/**
 * Whitelist of activity actions surfaced as user-facing notifications.
 * Everything else (logins, deletes, edits) goes only to the activity log
 * so the dropdown isn't flooded with routine bookkeeping.
 */
const NOTIFICATION_ACTIONS = new Set([
  "paid",
  "voided",
  "completed",
  "viewed",
  "portal_comment",
  "create_credit_note",
  "update_permissions",
]);

const POLL_INTERVAL = 60_000;

function actionLabel(t: (k: string) => string, action: string): string {
  return t(`notifications.action_${action}`) || action;
}

function actionPath(item: ActivityItem): string | null {
  if (item.resource_type === "invoice" && item.resource_id) {
    return `/invoices/${item.resource_id}`;
  }
  if (item.resource_type === "user" && item.resource_id) {
    return `/users`;
  }
  return null;
}

function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function NotificationsDropdown() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<ActivityItem[]>([]);
  // Persist per-user "last read" timestamp so the unread badge survives reloads.
  const [lastReadAt, setLastReadAt] = usePersistentState<string>(
    "inkvoice-notifications-last-read",
    "1970-01-01T00:00:00Z",
  );

  const fetchItems = useCallback(async () => {
    try {
      // Explicit page=1 matches the Activity page's URL shape and sidesteps
      // any stale browser-cached response for the bare ?limit=30 URL.
      const res = await api.listActivity({ page: "1", limit: "30" });
      const all: ActivityItem[] = res.data?.items ?? [];
      const filtered = all.filter((i) => NOTIFICATION_ACTIONS.has(i.action)).slice(0, 12);
      setItems(filtered);
    } catch {
      // Polling failure isn't worth surfacing to the user.
    }
  }, []);

  useEffect(() => {
    fetchItems();
    const id = setInterval(fetchItems, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchItems]);

  const unreadCount = useMemo(
    () => items.filter((i) => i.created_at > lastReadAt).length,
    [items, lastReadAt],
  );

  const markAllRead = () => {
    setLastReadAt(new Date().toISOString());
  };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && unreadCount > 0) markAllRead();
      }}
    >
      <DropdownMenuTrigger
        className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border/80 bg-background/40 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors relative"
        aria-label={t("notifications.aria_label")}
      >
        <Bell className="h-3.5 w-3.5" />
        {unreadCount > 0 && (
          <span
            role="status"
            className="absolute -top-1 -right-1 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-medium"
            aria-label={t("notifications.unread_count", { count: String(unreadCount) })}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="px-2 py-1 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t("notifications.title")}
          </span>
          {items.length > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <Check className="h-3 w-3" /> {t("notifications.mark_read")}
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="px-3 py-6 text-xs text-center text-muted-foreground">
            {t("notifications.empty")}
          </div>
        ) : (
          items.map((item) => {
            const meta = parseMeta(item.metadata);
            const isUnread = item.created_at > lastReadAt;
            const path = actionPath(item);
            return (
              <DropdownMenuItem
                key={item.id}
                onClick={() => path && navigate(path)}
                className="flex items-start gap-2 py-2"
              >
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    isUnread ? "bg-rose-500" : "bg-transparent"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] leading-snug">
                    <span className="font-medium">{actionLabel(t, item.action)}</span>
                    {typeof meta.invoice_number === "string" && (
                      <span className="text-muted-foreground"> · {meta.invoice_number}</span>
                    )}
                  </div>
                  {typeof meta.preview === "string" && (
                    <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                      {meta.preview}
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {item.user_name ? `${item.user_name} · ` : ""}
                    {formatRelativeTime(new Date(item.created_at).getTime(), t)}
                  </div>
                </div>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
