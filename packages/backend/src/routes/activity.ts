import { Hono } from "hono";
import { getResourceActivity, listActivity } from "../services/activity.service";

const activity = new Hono();

activity.get("/", (c) => {
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(c.req.query("limit") || "50", 10) || 50), 200);

  const data = listActivity({
    user_id: c.req.query("user_id"),
    resource_type: c.req.query("resource_type"),
    action: c.req.query("action"),
    date_from: c.req.query("date_from"),
    date_to: c.req.query("date_to"),
    page,
    limit,
  });
  return c.json({ success: true, data });
});

activity.get("/resource/:type/:id", (c) => {
  const entries = getResourceActivity(c.req.param("type"), c.req.param("id"));
  return c.json({ success: true, data: entries });
});

export { activity };
