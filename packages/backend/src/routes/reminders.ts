import { Hono } from "hono";
import { z } from "zod";
import * as reminderService from "../services/reminder.service";

const reminders = new Hono();

reminders.get("/", (c) => {
  const rules = reminderService.listRules();
  return c.json({ success: true, data: rules });
});

const ruleSchema = z.object({
  name: z.string().min(1).max(255),
  days_offset: z.number().int(),
  type: z.enum(["before_due", "on_due", "after_due"]),
  email_subject: z.string().min(1),
  email_body: z.string().min(1),
  is_active: z.boolean().optional(),
});

reminders.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = ruleSchema.parse(body);
  const rule = reminderService.createRule(parsed);
  return c.json({ success: true, data: rule }, 201);
});

reminders.put("/:id", async (c) => {
  const body = await c.req.json();
  const parsed = ruleSchema.partial().parse(body);
  const rule = reminderService.updateRule(c.req.param("id"), parsed);
  if (!rule) return c.json({ success: false, error: "Not found" }, 404);
  return c.json({ success: true, data: rule });
});

reminders.delete("/:id", (c) => {
  const ok = reminderService.deleteRule(c.req.param("id"));
  if (!ok) return c.json({ success: false, error: "Not found" }, 404);
  return c.json({ success: true });
});

export { reminders };
