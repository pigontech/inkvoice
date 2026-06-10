import type { Context, Next } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { createFeedback, listFeedback } from "../services/feedback.service";

const feedback = new Hono();

const createSchema = z.object({
  message: z.string().trim().min(1).max(5000),
  page_url: z.string().trim().max(500).optional(),
});

feedback.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { success: false, error: parsed.error.issues[0]?.message || "Invalid input" },
      400,
    );
  }
  const userId = c.get("userId") as string | undefined;
  const userAgent = c.req.header("user-agent") || null;
  const data = createFeedback({
    user_id: userId || null,
    message: parsed.data.message,
    page_url: parsed.data.page_url || null,
    user_agent: userAgent,
  });
  return c.json({ success: true, data }, 201);
});

const adminOnly = async (c: Context, next: Next) => {
  const user = c.get("user") as { is_admin?: boolean } | undefined;
  if (!user?.is_admin) return c.json({ success: false, error: "Forbidden" }, 403);
  await next();
};

feedback.get("/", adminOnly, (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") || "50", 10) || 50), 200);
  const data = listFeedback({ page, limit });
  return c.json({ success: true, data });
});

export { feedback };
