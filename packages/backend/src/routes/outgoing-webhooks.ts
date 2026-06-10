import { Hono } from "hono";
import { z } from "zod";
import * as webhookService from "../services/outgoing-webhooks.service";

const outgoingWebhooks = new Hono();

const SUPPORTED_EVENTS = [
  "invoice.paid",
  "invoice.sent",
  "invoice.overdue",
  "invoice.created",
  "invoice.voided",
  "invoice.viewed",
] as const;

const webhookSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  events: z.array(z.enum(SUPPORTED_EVENTS)).min(1),
  preset: z.enum(["generic", "slack"]).optional(),
  is_active: z.boolean().optional(),
});

outgoingWebhooks.get("/events", (c) => {
  return c.json({ success: true, data: { events: SUPPORTED_EVENTS } });
});

outgoingWebhooks.get("/", (c) => {
  return c.json({ success: true, data: webhookService.listWebhooks() });
});

outgoingWebhooks.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = webhookSchema.parse(body);
  const created = webhookService.createWebhook(parsed);
  return c.json({ success: true, data: created }, 201);
});

outgoingWebhooks.put("/:id", async (c) => {
  const body = await c.req.json();
  const parsed = webhookSchema.partial().parse(body);
  const updated = webhookService.updateWebhook(c.req.param("id"), parsed);
  if (!updated) return c.json({ success: false, error: "Webhook not found" }, 404);
  return c.json({ success: true, data: updated });
});

outgoingWebhooks.delete("/:id", (c) => {
  const ok = webhookService.deleteWebhook(c.req.param("id"));
  if (!ok) return c.json({ success: false, error: "Webhook not found" }, 404);
  return c.json({ success: true });
});

outgoingWebhooks.get("/:id/deliveries", (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);
  const deliveries = webhookService.listDeliveries(c.req.param("id"), limit);
  return c.json({ success: true, data: deliveries });
});

outgoingWebhooks.post("/deliveries/:id/retry", async (c) => {
  const result = await webhookService.retryDelivery(c.req.param("id"));
  if (!result) return c.json({ success: false, error: "Delivery not found" }, 404);
  return c.json({ success: true, data: result });
});

export { outgoingWebhooks };
