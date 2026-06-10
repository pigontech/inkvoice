import { Hono } from "hono";
import { z } from "zod";
import * as recurringService from "../services/recurring.service";

const recurring = new Hono();

recurring.get("/", (c) => {
  const status = c.req.query("status");
  const data = recurringService.listRecurring(status ? { status } : undefined);
  return c.json({ success: true, data });
});

recurring.get("/:id", (c) => {
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
});

recurring.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createSchema.parse(body);
  const item = recurringService.createRecurring(parsed);
  return c.json({ success: true, data: item }, 201);
});

recurring.put("/:id", async (c) => {
  const body = await c.req.json();
  const parsed = createSchema.partial().parse(body);
  const item = recurringService.updateRecurring(c.req.param("id"), parsed);
  if (!item) return c.json({ success: false, error: "Not found" }, 404);
  return c.json({ success: true, data: item });
});

recurring.delete("/:id", (c) => {
  const result = recurringService.deleteRecurring(c.req.param("id"));
  if (!result.success) return c.json({ success: false, error: result.error }, 400);
  return c.json({ success: true });
});

recurring.post("/:id/pause", (c) => {
  const ok = recurringService.pauseRecurring(c.req.param("id"));
  if (!ok) return c.json({ success: false, error: "Cannot pause" }, 400);
  return c.json({ success: true });
});

recurring.post("/:id/resume", (c) => {
  const ok = recurringService.resumeRecurring(c.req.param("id"));
  if (!ok) return c.json({ success: false, error: "Cannot resume" }, 400);
  return c.json({ success: true });
});

recurring.post("/:id/generate-now", (c) => {
  const invoiceId = recurringService.generateInvoice(c.req.param("id"));
  if (!invoiceId) return c.json({ success: false, error: "Cannot generate" }, 400);
  return c.json({ success: true, data: { invoice_id: invoiceId } });
});

export { recurring };
