import { History } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";

function formatAction(entry: any): string {
  const meta = entry.metadata ? JSON.parse(entry.metadata) : {};
  const user = entry.user_name || "System";
  const resource = entry.resource_type;
  const id =
    meta.invoice_number ||
    meta.quote_number ||
    meta.customer_name ||
    meta.product_name ||
    entry.resource_id?.slice(0, 8) ||
    "";

  return `${user} ${entry.action} ${resource} ${id}`.trim();
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString();
}

const RESOURCE_COLORS: Record<string, string> = {
  invoice: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25",
  customer: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
  product: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25",
  user: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25",
  quote: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/25",
  payment: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/25",
  settings: "bg-muted/60 text-muted-foreground border-border/60",
};

export default function ActivityLog() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [resourceFilter, setResourceFilter] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchActivity = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params: Record<string, string> = { page: String(page), limit: "50" };
      if (resourceFilter) params.resource_type = resourceFilter;
      const res = await api.listActivity(params);
      setEntries(res.data.items);
      setTotal(res.data.total);
    } catch (e) {
      setLoadError(formatApiError(e, t));
    } finally {
      setLoading(false);
    }
  }, [page, resourceFilter, t]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  const totalPages = Math.ceil(total / 50);

  const handleClick = (entry: any) => {
    if (entry.resource_id) {
      const routes: Record<string, string> = {
        invoice: `/invoices/${entry.resource_id}`,
        customer: `/customers/${entry.resource_id}`,
        product: `/products/${entry.resource_id}`,
        quote: `/quotes/${entry.resource_id}`,
      };
      if (routes[entry.resource_type]) navigate(routes[entry.resource_type]);
    }
  };

  if (loadError && !loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">{t("activity.title")}</h1>
        <div className="flex flex-col items-center justify-center gap-4 min-h-[40vh] px-4">
          <p className="text-muted-foreground text-center max-w-md">{loadError}</p>
          <Button type="button" onClick={() => fetchActivity()}>
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("activity.title")}</h1>
      </div>

      <div className="flex gap-2">
        <select
          value={resourceFilter}
          onChange={(e) => {
            setResourceFilter(e.target.value);
            setPage(1);
          }}
          className="form-select text-sm"
        >
          <option value="">{t("activity.filter_all")}</option>
          <option value="invoice">{t("activity.filter_invoices")}</option>
          <option value="customer">{t("activity.filter_customers")}</option>
          <option value="product">{t("activity.filter_products")}</option>
          <option value="quote">{t("activity.filter_quotes")}</option>
          <option value="user">{t("activity.filter_users")}</option>
          <option value="settings">{t("activity.filter_settings")}</option>
        </select>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex justify-center py-16" role="status">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <History className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
              <p>{t("activity.no_activity")}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {entries.map((entry: any) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-accent/50 cursor-pointer transition-colors"
                  onClick={() => handleClick(entry)}
                >
                  <Badge
                    variant="secondary"
                    className={`text-[10px] min-w-[70px] justify-center ${RESOURCE_COLORS[entry.resource_type] || ""}`}
                  >
                    {entry.resource_type}
                  </Badge>
                  <span className="text-sm flex-1">{formatAction(entry)}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatTime(entry.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t("common.previous")}
          </Button>
          <span className="text-sm py-2 text-muted-foreground tabular-nums">
            {t("common.page_of", { page: String(page), total: String(totalPages) })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            {t("common.next")}
          </Button>
        </div>
      )}
    </div>
  );
}
