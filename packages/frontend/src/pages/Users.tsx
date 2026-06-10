import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { BatchActionToolbar } from "@/components/shared/BatchActionToolbar";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { FormField } from "@/components/shared/FormField";
import {
  SortableColumnHeader,
  type SortState,
  sortData,
} from "@/components/shared/SortableColumnHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useTranslation } from "@/i18n";
import { formatApiError } from "@/lib/format-api-error";
import { useAuthStore } from "@/stores/auth.store";

export default function Users() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<any[]>([]);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });
  const [batchAction, setBatchAction] = useState<{ action: string; label: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const currentUser = useAuthStore((s) => s.user);

  const fetchUsers = useCallback(async () => {
    const res = await api.listUsers();
    setUsers(res.data);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);
  useEffect(() => {
    setSelected(new Set());
  }, []);

  const sorted = sortData(users, sort);
  const selectableIds = sorted.filter((u: any) => u.id !== currentUser?.id).map((u: any) => u.id);
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id: string) => selected.has(id));
  const someSelected = selectableIds.some((id: string) => selected.has(id));

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectableIds));
  };
  const handleSort = (key: string, direction: "asc" | "desc" | null) => {
    setSort(direction ? { key, direction } : null);
  };

  const handleDelete = async () => {
    if (!deleteConfirm.id) return;
    setActionLoading(true);
    try {
      await api.deleteUser(deleteConfirm.id);
      toast.success(t("users.user_deleted"));
      fetchUsers();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setActionLoading(false);
      setDeleteConfirm({ open: false, id: null });
    }
  };

  const executeBatch = async () => {
    if (!batchAction) return;
    setActionLoading(true);
    try {
      const res = await api.batchUsers(Array.from(selected), batchAction.action);
      if (res.data.succeeded > 0)
        toast.success(t("users.batch_updated", { count: res.data.succeeded }));
      if (res.data.failed > 0)
        toast.error(t("users.batch_update_failed", { count: res.data.failed }));
      setSelected(new Set());
      fetchUsers();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setActionLoading(false);
      setBatchAction(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("users.title")}</h1>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-2" /> {t("users.add_user")}
        </Button>
      </div>

      <BatchActionToolbar selectedCount={selected.size} onClear={() => setSelected(new Set())}>
        <Button
          size="xs"
          variant="destructive"
          onClick={() => setBatchAction({ action: "delete", label: t("common.delete") })}
        >
          {t("common.delete")}
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => setBatchAction({ action: "activate", label: t("users.activate") })}
        >
          {t("users.activate")}
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => setBatchAction({ action: "deactivate", label: t("users.deactivate") })}
        >
          {t("users.deactivate")}
        </Button>
      </BatchActionToolbar>

      <div className="glass-table-wrapper">
        <Table>
          <TableHeader>
            <TableRow>
              <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  onCheckedChange={toggleAll}
                />
              </TableCell>
              <SortableColumnHeader
                label={t("users.username")}
                sortKey="username"
                currentSort={sort}
                onSort={handleSort}
              />
              <SortableColumnHeader
                label={t("users.display_name")}
                sortKey="display_name"
                currentSort={sort}
                onSort={handleSort}
              />
              <SortableColumnHeader
                label={t("users.email")}
                sortKey="email"
                currentSort={sort}
                onSort={handleSort}
              />
              <SortableColumnHeader
                label={t("users.role")}
                sortKey="is_admin"
                currentSort={sort}
                onSort={handleSort}
              />
              <SortableColumnHeader
                label={t("users.status")}
                sortKey="is_active"
                currentSort={sort}
                onSort={handleSort}
              />
              <TableCell className="w-[100px] font-medium text-sm text-muted-foreground">
                {t("common.actions")}
              </TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((u: any) => (
              <TableRow
                key={u.id}
                className="cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => setEditingUser(u)}
              >
                <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                  {u.id !== currentUser?.id && (
                    <Checkbox
                      checked={selected.has(u.id)}
                      onCheckedChange={() => toggleSelect(u.id)}
                    />
                  )}
                </TableCell>
                <TableCell className="font-medium">{u.username}</TableCell>
                <TableCell>{u.display_name || "-"}</TableCell>
                <TableCell>{u.email || "-"}</TableCell>
                <TableCell>
                  {u.role ? (
                    <Badge
                      variant={u.role === "Owner" ? "default" : "secondary"}
                      title={t("users.role")}
                    >
                      {u.role}
                    </Badge>
                  ) : (
                    <Badge variant={u.is_admin ? "default" : "secondary"}>
                      {u.is_admin ? t("common.admin") : t("common.user")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={u.is_active ? "default" : "secondary"}
                    className={
                      u.is_active
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25"
                        : ""
                    }
                  >
                    {u.is_active ? t("common.active") : t("common.inactive")}
                  </Badge>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("common.edit")}
                      onClick={() => setEditingUser(u)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {u.id !== currentUser?.id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("common.delete")}
                        onClick={() => setDeleteConfirm({ open: true, id: u.id })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {(creating || editingUser) && (
        <UserFormDialog
          user={editingUser}
          onClose={() => {
            setEditingUser(null);
            setCreating(false);
          }}
          onSave={() => {
            setEditingUser(null);
            setCreating(false);
            fetchUsers();
          }}
        />
      )}

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirm({ open: false, id: null });
        }}
        title={t("users.delete_title")}
        description={t("users.delete_description")}
        confirmLabel={t("common.delete")}
        variant="destructive"
        onConfirm={handleDelete}
        loading={actionLoading}
      />

      <ConfirmDialog
        open={!!batchAction}
        onOpenChange={(open) => {
          if (!open) setBatchAction(null);
        }}
        title={t("users.batch_action_title", {
          action: batchAction?.label ?? "",
          count: selected.size,
        })}
        description={
          batchAction?.action === "delete"
            ? t("users.batch_delete_description")
            : t("users.batch_confirm", { action: batchAction?.label.toLowerCase() ?? "" })
        }
        confirmLabel={batchAction?.label || t("common.confirm")}
        variant={batchAction?.action === "delete" ? "destructive" : "default"}
        onConfirm={executeBatch}
        loading={actionLoading}
      />
    </div>
  );
}

function UserFormDialog({
  user,
  onClose,
  onSave,
}: {
  user: any;
  onClose: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    username: user?.username || "",
    email: user?.email || "",
    display_name: user?.display_name || "",
    password: "",
    is_admin: user?.is_admin ? 1 : 0,
    is_active: user?.is_active ?? 1,
    role: user?.role || (user?.is_admin ? "Owner" : "Viewer"),
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const validate = useCallback(
    (f: typeof form): Record<string, string> => {
      const newErrors: Record<string, string> = {};
      if (!f.username.trim()) newErrors.username = t("users.username_required");
      if (f.username.length > 50) newErrors.username = t("users.username_max");
      if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email))
        newErrors.email = t("users.email_invalid");
      if (!user && !f.password) newErrors.password = t("users.password_required");
      if (f.password && f.password.length < 6) newErrors.password = t("users.password_min");
      return newErrors;
    },
    [user, t],
  );

  useEffect(() => {
    if (hasSubmitted) {
      setErrors(validate(form));
    }
  }, [form, hasSubmitted, validate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasSubmitted(true);
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setLoading(true);
    try {
      if (user) {
        const data: any = { ...form };
        if (!data.password) delete data.password;
        await api.updateUser(user.id, data);
        toast.success(t("users.user_updated"));
      } else {
        await api.createUser(form);
        toast.success(t("users.user_created"));
      }
      onSave();
    } catch (err: unknown) {
      toast.error(formatApiError(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user ? t("users.edit_user") : t("users.new_user")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <FormField label={t("users.username")} error={errors.username} required>
            <Input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              aria-invalid={!!errors.username}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label={t("users.display_name")}>
              <Input
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              />
            </FormField>
            <FormField label={t("users.email")} error={errors.email}>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                aria-invalid={!!errors.email}
              />
            </FormField>
          </div>
          <FormField
            label={user ? t("users.new_password") : t("users.password")}
            error={errors.password}
            required={!user}
          >
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              aria-invalid={!!errors.password}
            />
          </FormField>
          <FormField label={t("users.role")}>
            <select
              value={form.role}
              onChange={(e) => {
                const role = e.target.value;
                setForm({ ...form, role, is_admin: role === "Owner" ? 1 : 0 });
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              disabled={form.role === "Owner" && user?.role === "Owner"}
            >
              <option value="Owner">Owner</option>
              <option value="Admin">Admin</option>
              <option value="Accountant">Accountant</option>
              <option value="Viewer">Viewer</option>
            </select>
          </FormField>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked ? 1 : 0 })}
                className="rounded"
              />
              <span className="text-sm">{t("users.active_label")}</span>
            </label>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
