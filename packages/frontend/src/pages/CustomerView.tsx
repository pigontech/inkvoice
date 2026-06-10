import { DollarSign, FileText, Pencil, Receipt } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/api/client";
import { CustomerStatementDialog } from "@/components/customers/CustomerStatementDialog";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { Badge } from "@/components/ui/badge";
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
import { STATUS_COLORS } from "@/lib/constants";
import { pushRecentlyViewed } from "@/lib/recently-viewed";
import { formatCurrency, formatDate } from "@/lib/utils";

/**
 * Read-only customer detail page. Opening a customer from the list or search
 * lands here; editing is an explicit action (pencil → /customers/:id/edit).
 */
export default function CustomerView() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<any | null>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [statementOpen, setStatementOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.getCustomer(id).then((r) => {
      setCustomer(r.data);
      if (r.data?.name) {
        pushRecentlyViewed({
          type: "customer",
          id,
          label: r.data.name,
          sublabel: r.data.email ?? undefined,
        });
      }
    });
    api.listInvoices({ customer_id: id, limit: "50" }).then((r) => setInvoices(r.data.items));
  }, [id]);

  if (!customer) {
    return (
      <div className="flex justify-center py-20" role="status">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        <span className="sr-only">{t("common.loading")}</span>
      </div>
    );
  }

  const outstanding = invoices
    .filter((inv: any) => inv.status === "sent" || inv.status === "overdue")
    .reduce((sum: number, inv: any) => sum + inv.total, 0);

  const addressParts = [
    customer.address_line1,
    customer.address_line2,
    [customer.postal_code, customer.city].filter(Boolean).join(" "),
    customer.state,
    customer.country,
  ].filter(Boolean);

  const contactRows: Array<[string, string]> = [
    [t("customers.email"), customer.email],
    [t("customers.phone"), customer.phone],
    [t("customers.tax_id"), customer.tax_id],
  ].filter((row): row is [string, string] => !!row[1]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-2">
        <div>
          <Breadcrumbs
            items={[
              { label: t("nav.dashboard"), href: "/" },
              { label: t("nav.customers"), href: "/customers" },
              { label: customer.name },
            ]}
          />
          <h1 className="text-2xl font-semibold tracking-tight mt-2">{customer.name}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/customers")}>
            {t("common.back")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setStatementOpen(true)}>
            <Receipt className="h-4 w-4" />
            {t("customers.statement")}
          </Button>
          <Button size="sm" onClick={() => navigate(`/customers/${id}/edit`)}>
            <Pencil className="h-4 w-4" />
            {t("common.edit")}
          </Button>
        </div>
      </div>

      {id && (
        <CustomerStatementDialog
          open={statementOpen}
          onOpenChange={setStatementOpen}
          customerId={id}
          customerEmail={customer.email ?? null}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6 items-start">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("customers.contact_info")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {contactRows.length === 0 && addressParts.length === 0 && !customer.notes && (
                <p className="text-sm text-muted-foreground">-</p>
              )}
              {contactRows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="text-right break-all">{value}</span>
                </div>
              ))}
              {addressParts.length > 0 && (
                <div className="flex justify-between gap-4 text-sm">
                  <span className="text-muted-foreground">{t("customers.address")}</span>
                  <span className="text-right">{addressParts.join(", ")}</span>
                </div>
              )}
              {customer.notes && (
                <div className="text-sm">
                  <span className="text-muted-foreground">{t("invoices.notes")}</span>
                  <p className="mt-1 whitespace-pre-wrap">{customer.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <DollarSign className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium uppercase tracking-wide">
                    {t("customers.total_revenue")}
                  </span>
                </div>
                <p className="text-lg font-semibold tabular-nums">
                  {formatCurrency(customer.total_revenue || 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <DollarSign className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium uppercase tracking-wide">
                    {t("dashboard.outstanding")}
                  </span>
                </div>
                <p className="text-lg font-semibold tabular-nums">{formatCurrency(outstanding)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <FileText className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium uppercase tracking-wide">
                    {t("nav.invoices")}
                  </span>
                </div>
                <p className="text-lg font-semibold tabular-nums">{customer.invoice_count || 0}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("customers.recent_invoices")}</CardTitle>
            </CardHeader>
            <CardContent>
              {invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  {t("customers.no_invoices")}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("customers.invoice_number")}</TableHead>
                      <TableHead>{t("customers.date")}</TableHead>
                      <TableHead className="text-right">{t("common.total")}</TableHead>
                      <TableHead>{t("invoices.status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv: any) => (
                      <TableRow
                        key={inv.id}
                        className="cursor-pointer hover:bg-accent/50 transition-colors"
                        onClick={() => navigate(`/invoices/${inv.id}`)}
                      >
                        <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(inv.issue_date)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(inv.total, inv.currency)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={STATUS_COLORS[inv.status]}>
                            {t(`invoices.status_${inv.status}`)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
