import { Hono } from "hono";
import { z } from "zod";
import * as taxService from "../services/tax.service";

const tax = new Hono();

tax.get("/", (c) => {
  const data = taxService.listTaxDefinitions();
  return c.json({ success: true, data });
});

const taxSchema = z.object({
  name: z.string().min(1).max(100),
  rate: z.number().min(0).max(100),
  description: z.string().max(255).optional().or(z.literal("")),
  category_code: z.enum(["S", "Z", "E", "AE", "G", "O", "K", "L", "M"]).optional(),
  vendor_tax_id: z.string().max(100).optional().or(z.literal("")),
  is_default: z.number().min(0).max(1).optional(),
  is_active: z.number().min(0).max(1).optional(),
});

tax.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = taxSchema.parse(body);
  const def = taxService.createTaxDefinition(parsed);
  return c.json({ success: true, data: def }, 201);
});

tax.put("/:id", async (c) => {
  const body = await c.req.json();
  const parsed = taxSchema.parse(body);
  const def = taxService.updateTaxDefinition(c.req.param("id"), parsed);
  if (!def) {
    return c.json({ success: false, error: "Tax definition not found" }, 404);
  }
  return c.json({ success: true, data: def });
});

tax.delete("/:id", (c) => {
  const result = taxService.deleteTaxDefinition(c.req.param("id"));
  if (!result.success) {
    return c.json({ success: false, error: result.error }, 409);
  }
  return c.json({ success: true });
});

export { tax };
