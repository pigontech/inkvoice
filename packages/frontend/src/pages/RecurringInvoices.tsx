import { Pause, Pencil, Play, Plus, RefreshCw, Repeat, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";
import { formatDate } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  paused: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  completed: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

const RECURRING_TAB_SEGMENTS = new Set(["all", "active", "paused", "completed"]);

export default function RecurringInvoices() {
  const { t } = useTranslation();
  const [items, setItems] = useState<any[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const navigate = useNavigate();

  const FREQ_LABELS: Record<string, string> = {
    daily: t("recurring.freq_daily"),
    weekly: t("recurring.freq_weekly"),
    monthly: t("recurring.freq_monthly"),
    yearly: t("recurring.freq_yearly"),
  };
  const { tab } = useParams<{ tab: string }>();
  const statusFilter = tab && RECURRING_TAB_SEGMENTS.has(tab) ? tab : "all";

  const fetchItems = useCallback(async () => {
    const params: Record<string, string> = {};
    if (statusFilter !== "all") params.status = statusFilter;
    const res = await api.listRecurring(params);
    setItems(res.data);
  }, [statusFilter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    if (tab && !RECURRING_TAB_SEGMENTS.has(tab)) {
      navigate("/recurring/all", { replace: true });
    }
  }, [tab, navigate]);

  const handlePause = async (id: string) => {
    try {
      await api.pauseRecurring(id);
      toast.success(t("recurring.schedule_paused"));
      fetchItems();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    }
  };

  const handleResume = async (id: string) => {
    try {
      await api.resumeRecurring(id);
      toast.success(t("recurring.schedule_resumed"));
      fetchItems();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    }
  };

  const handleGenerateNow = async (id: string) => {
    try {
      const res = await api.generateRecurringNow(id);
      toast.success(t("recurring.invoice_generated"));
      navigate(`/invoices/${res.data.invoice_id}`);
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setActionLoading(true);
    try {
      await api.deleteRecurring(deleteId);
      toast.success(t("recurring.schedule_deleted"));
      setDeleteId(null);
      fetchItems();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("recurring.title")}</h1>
        <Button onClick={() => navigate("/recurring/new")}>
          <Plus className="h-4 w-4 mr-2" /> {t("recurring.new_schedule")}
        </Button>
      </div>

      <Tabs value={statusFilter} onValueChange={(v) => navigate(`/recurring/${v}`)}>
        <TabsList>
          <TabsTrigger value="all">{t("recurring.tab_all")}</TabsTrigger>
          <TabsTrigger value="active">{t("recurring.tab_active")}</TabsTrigger>
          <TabsTrigger value="paused">{t("recurring.tab_paused")}</TabsTrigger>
          <TabsTrigger value="completed">{t("recurring.tab_completed")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="glass-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableCell className="font-medium text-sm text-muted-foreground">
                {t("recurring.customer")}
              </TableCell>
              <TableCell className="font-medium text-sm text-muted-foreground">
                {t("recurring.frequency")}
              </TableCell>
              <TableCell className="font-medium text-sm text-muted-foreground">
                {t("recurring.next_run")}
              </TableCell>
              <TableCell className="font-medium text-sm text-muted-foreground">
                {t("recurring.last_generated")}
              </TableCell>
              <TableCell className="font-medium text-sm text-muted-foreground text-right">
                {t("recurring.generated")}
              </TableCell>
              <TableCell className="font-medium text-sm text-muted-foreground">
                {t("recurring.status")}
              </TableCell>
              <TableCell className="font-medium text-sm text-muted-foreground">
                {t("common.actions")}
              </TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                  <div className="space-y-2">
                    <Repeat className="h-8 w-8 mx-auto text-muted-foreground/50" />
                    <p>{t("recurring.no_schedules")}</p>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {items.map((item: any) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">{item.customer_name}</TableCell>
                <TableCell>
                  {item.interval_value > 1 ? `Every ${item.interval_value} ` : ""}
                  {FREQ_LABELS[item.frequency] || item.frequency}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.status === "completed" ? "-" : formatDate(item.next_run_date)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.last_generated_at ? formatDate(item.last_generated_at) : "-"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{item.total_generated}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className={STATUS_COLORS[item.status]}>
                    {item.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {item.status !== "completed" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => navigate(`/recurring/${item.id}/edit`)}
                        title={t("common.edit")}
                        aria-label={t("common.edit")}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {item.status === "active" && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handlePause(item.id)}
                          title={t("recurring.pause")}
                          aria-label={t("recurring.pause")}
                        >
                          <Pause className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleGenerateNow(item.id)}
                          title={t("recurring.generate_now")}
                          aria-label={t("recurring.generate_now")}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    {item.status === "paused" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleResume(item.id)}
                        title={t("recurring.resume")}
                        aria-label={t("recurring.resume")}
                      >
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setDeleteId(item.id)}
                      title={t("common.delete")}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        title={t("recurring.delete_title")}
        description={t("recurring.delete_description")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDelete}
        loading={actionLoading}
      />
    </div>
  );
}
