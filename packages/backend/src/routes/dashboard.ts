import { Hono } from "hono";
import { hasPermission, requirePermission } from "../middleware/auth";
import * as dashboardService from "../services/dashboard.service";

const dashboard = new Hono();

// The dashboard is a summary of invoices, so it needs read access to them.
dashboard.use("*", requirePermission("invoices", "read"));

dashboard.get("/stats", (c) => {
  const stats = dashboardService.getStats();
  // Net income gives total expenses away, so both go without expense access.
  const data = hasPermission(c.get("user"), "expenses", "read")
    ? stats
    : { ...stats, total_expenses: null, net_income: null };
  return c.json({ success: true, data });
});

dashboard.get("/revenue-chart", (c) => {
  const compareYoy = c.req.query("compare") === "yoy";
  const data = dashboardService.getRevenueChart(compareYoy);
  return c.json({ success: true, data });
});

dashboard.get("/recent-invoices", (c) => {
  const data = dashboardService.getRecentInvoices();
  return c.json({ success: true, data });
});

dashboard.get("/top-customers", (c) => {
  const limitParam = parseInt(c.req.query("limit") || "5", 10);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 5, 1), 50);
  const data = dashboardService.getTopCustomersByRevenue(limit);
  return c.json({ success: true, data });
});

export { dashboard };
