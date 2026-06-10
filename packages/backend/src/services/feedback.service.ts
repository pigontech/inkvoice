import crypto from "node:crypto";
import { getDb } from "../database/connection";
import { getEnv } from "../utils/env";
import { logger } from "../utils/logger";

export interface FeedbackEntry {
  id: string;
  user_id: string | null;
  user_name: string | null;
  message: string;
  page_url: string | null;
  user_agent: string | null;
  created_at: string;
}

export function createFeedback(entry: {
  user_id?: string | null;
  message: string;
  page_url?: string | null;
  user_agent?: string | null;
}): FeedbackEntry {
  const db = getDb();
  const id = crypto.randomBytes(16).toString("hex");
  db.run(
    "INSERT INTO feedback (id, user_id, message, page_url, user_agent) VALUES (?, ?, ?, ?, ?)",
    [id, entry.user_id || null, entry.message, entry.page_url || null, entry.user_agent || null],
  );
  const saved = db
    .query(
      `SELECT f.*, u.username as user_name
       FROM feedback f LEFT JOIN users u ON f.user_id = u.id
       WHERE f.id = ?`,
    )
    .get(id) as FeedbackEntry;
  notifySlack(saved);
  return saved;
}

function notifySlack(entry: FeedbackEntry): void {
  const url = getEnv().SLACK_WEBHOOK_URL;
  if (!url) return;
  const lines = [
    `*New feedback*`,
    `*From:* ${entry.user_name || "anonymous"}${entry.user_id ? ` (${entry.user_id})` : ""}`,
    `*Page:* ${entry.page_url || "—"}`,
    `*User-Agent:* ${entry.user_agent || "—"}`,
    `*Message:*\n${entry.message}`,
  ];
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: lines.join("\n") }),
  }).catch((err) => {
    logger.error({ err }, "[feedback] Slack webhook failed");
  });
}

export function listFeedback(params: { page: number; limit: number }): {
  items: FeedbackEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
} {
  const db = getDb();
  const offset = (params.page - 1) * params.limit;
  const countRow = db.query("SELECT COUNT(*) as count FROM feedback").get() as { count: number };
  const items = db
    .query(
      `SELECT f.*, u.username as user_name
       FROM feedback f LEFT JOIN users u ON f.user_id = u.id
       ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(params.limit, offset) as FeedbackEntry[];
  return {
    items,
    total: countRow.count,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(countRow.count / params.limit),
  };
}
