import crypto from "node:crypto";
import { getDb } from "../database/connection";
import type { PaginatedResponse } from "../types/common";

export interface ActivityEntry {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: string | null;
  created_at: string;
}

export function logActivity(entry: {
  user_id?: string | null;
  user_name?: string | null;
  action: string;
  resource_type: string;
  resource_id?: string | null;
  metadata?: Record<string, unknown>;
}): void {
  try {
    const db = getDb();
    const id = crypto.randomBytes(16).toString("hex");
    db.run(
      "INSERT INTO activity_log (id, user_id, user_name, action, resource_type, resource_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        entry.user_id || null,
        entry.user_name || null,
        entry.action,
        entry.resource_type,
        entry.resource_id || null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      ],
    );
  } catch {
    // Fire-and-forget: don't let logging failures break the main operation
  }
}

export function listActivity(params: {
  user_id?: string;
  resource_type?: string;
  action?: string;
  date_from?: string;
  date_to?: string;
  page: number;
  limit: number;
}): PaginatedResponse<ActivityEntry> {
  const db = getDb();
  const conditions: string[] = [];
  const queryParams: string[] = [];

  if (params.user_id) {
    conditions.push("user_id = ?");
    queryParams.push(params.user_id);
  }
  if (params.resource_type) {
    conditions.push("resource_type = ?");
    queryParams.push(params.resource_type);
  }
  if (params.action) {
    conditions.push("action = ?");
    queryParams.push(params.action);
  }
  if (params.date_from) {
    conditions.push("created_at >= ?");
    queryParams.push(params.date_from);
  }
  if (params.date_to) {
    conditions.push("created_at <= ?");
    queryParams.push(`${params.date_to}T23:59:59`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (params.page - 1) * params.limit;

  const countRow = db
    .query(`SELECT COUNT(*) as count FROM activity_log ${where}`)
    .get(...queryParams) as { count: number };

  const items = db
    .query(`SELECT * FROM activity_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...queryParams, params.limit, offset) as ActivityEntry[];

  return {
    items,
    total: countRow.count,
    page: params.page,
    limit: params.limit,
    totalPages: Math.ceil(countRow.count / params.limit),
  };
}

export function getResourceActivity(resourceType: string, resourceId: string): ActivityEntry[] {
  const db = getDb();
  return db
    .query(
      "SELECT * FROM activity_log WHERE resource_type = ? AND resource_id = ? ORDER BY created_at DESC",
    )
    .all(resourceType, resourceId) as ActivityEntry[];
}
