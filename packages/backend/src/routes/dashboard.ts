import { Hono } from "hono";
import * as dashboardService from "../services/dashboard.service";

const dashboard = new Hono();

dashboard.get("/stats", (c) => {
  const data = dashboardService.getStats();
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
