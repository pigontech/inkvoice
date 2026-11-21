import { Hono } from "hono";
import { z } from "zod";
import { requirePermission } from "../middleware/auth";
import * as recurringService from "../services/recurring.service";
import { SERVICE_PERIOD_MODES } from "../utils/recurring-period";

const recurring = new Hono();

recurring.get("/", requirePermission("invoices", "read"), (c) => {
  const status = c.req.query("status");
  const data = recurringService.listRecurring(status ? { status } : undefined);
  return c.json({ success: true, data });
});

recurring.get("/:id", requirePermission("invoices", "read"), (c) => {
  const item = recurringService.getRecurring(c.req.param("id"));
  if (!item) return c.json({ success: false, error: "Not found" }, 404);
  return c.json({ success: true, data: item });
});

const createSchema = z.object({
  customer_id: z.string().min(1),
  template_invoice_id: z.string().min(1),
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval_value: z.number().int().min(1).optional(),
  next_run_date: z.string().min(1),
  end_date: z.string().optional().nullable(),
  auto_send: z.boolean().optional(),
  auto_bill: z.boolean().optional(),
  service_period_mode: z.enum(SERVICE_PERIOD_MODES).optional(),
});

recurring.post("/", requirePermission("invoices", "create"), async (c) => {
  const body = await c.req.json();
  const parsed = createSchema.parse(body);
  const item = recurringService.createRecurring(parsed);
  return c.json({ success: true, data: item }, 201);
});

recurring.put("/:id", requirePermission("invoices", "update"), async (c) => {
  const body = await c.req.json();
  const parsed = createSchema.partial().parse(body);
  const item = recurringService.updateRecurring(c.req.param("id"), parsed);
  if (!item) return c.json({ success: false, error: "Not found" }, 404);
  return c.json({ success: true, data: item });
});

recurring.delete("/:id", requirePermission("invoices", "delete"), (c) => {
  const result = recurringService.deleteRecurring(c.req.param("id"));
  if (!result.success) return c.json({ success: false, error: result.error }, 400);
  return c.json({ success: true });
});

recurring.post("/:id/pause", requirePermission("invoices", "update"), (c) => {
  const ok = recurringService.pauseRecurring(c.req.param("id"));
  if (!ok) return c.json({ success: false, error: "Cannot pause" }, 400);
  return c.json({ success: true });
});

recurring.post("/:id/resume", requirePermission("invoices", "update"), (c) => {
  const ok = recurringService.resumeRecurring(c.req.param("id"));
  if (!ok) return c.json({ success: false, error: "Cannot resume" }, 400);
  return c.json({ success: true });
});

recurring.post("/:id/generate-now", requirePermission("invoices", "create"), async (c) => {
  const invoiceId = await recurringService.generateInvoice(c.req.param("id"));
  if (!invoiceId) return c.json({ success: false, error: "Cannot generate" }, 400);
  return c.json({ success: true, data: { invoice_id: invoiceId } });
});

export { recurring };
