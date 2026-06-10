import crypto from "node:crypto";
import { getDb } from "../database/connection";
import { validateUrl } from "../utils/ssrf-protection";

export type WebhookPreset = "generic" | "slack";

export interface OutgoingWebhook {
  id: string;
  name: string;
  url: string;
  events: string;
  preset: WebhookPreset;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: string | null;
  status_code: number | null;
  response_body: string | null;
  error_message: string | null;
  attempt_count: number;
  created_at: string;
}

export function listWebhooks(): OutgoingWebhook[] {
  const db = getDb();
  return db
    .query("SELECT * FROM outgoing_webhooks ORDER BY created_at DESC")
    .all() as OutgoingWebhook[];
}

export function getWebhook(id: string): OutgoingWebhook | null {
  const db = getDb();
  return db.query("SELECT * FROM outgoing_webhooks WHERE id = ?").get(id) as OutgoingWebhook | null;
}

export function createWebhook(data: {
  name: string;
  url: string;
  events: string[];
  preset?: WebhookPreset;
  is_active?: boolean;
}): OutgoingWebhook {
  const db = getDb();
  const id = crypto.randomBytes(16).toString("hex");
  db.run(
    "INSERT INTO outgoing_webhooks (id, name, url, events, preset, is_active) VALUES (?, ?, ?, ?, ?, ?)",
    [
      id,
      data.name,
      data.url,
      JSON.stringify(data.events),
      data.preset ?? "generic",
      data.is_active === false ? 0 : 1,
    ],
  );
  return getWebhook(id)!;
}

export function updateWebhook(
  id: string,
  data: Partial<{
    name: string;
    url: string;
    events: string[];
    preset: WebhookPreset;
    is_active: boolean;
  }>,
): OutgoingWebhook | null {
  const existing = getWebhook(id);
  if (!existing) return null;
  const db = getDb();
  db.run(
    `UPDATE outgoing_webhooks
     SET name = ?, url = ?, events = ?, preset = ?, is_active = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [
      data.name ?? existing.name,
      data.url ?? existing.url,
      data.events ? JSON.stringify(data.events) : existing.events,
      data.preset ?? existing.preset,
      data.is_active === undefined ? existing.is_active : data.is_active ? 1 : 0,
      id,
    ],
  );
  return getWebhook(id);
}

export function deleteWebhook(id: string): boolean {
  const db = getDb();
  const result = db.run("DELETE FROM outgoing_webhooks WHERE id = ?", [id]);
  return result.changes > 0;
}

export function listDeliveries(webhookId: string, limit = 50): WebhookDelivery[] {
  const db = getDb();
  return db
    .query("SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(webhookId, limit) as WebhookDelivery[];
}

export function getDelivery(id: string): WebhookDelivery | null {
  const db = getDb();
  return db
    .query("SELECT * FROM webhook_deliveries WHERE id = ?")
    .get(id) as WebhookDelivery | null;
}

/**
 * Format an event payload for the destination. Generic webhooks receive the
 * raw event JSON; Slack receives a pre-rendered "Slack incoming-webhook"
 * shape so users can paste their workspace URL and get a readable message.
 */
function formatPayload(
  preset: WebhookPreset,
  event_type: string,
  data: Record<string, unknown>,
): string {
  if (preset === "slack") {
    let message = `*${event_type}*`;
    if (event_type === "invoice.paid") {
      const inv = data as {
        invoice_number?: string;
        total?: number;
        currency?: string;
        customer_name?: string;
      };
      message = `:moneybag: Invoice *${inv.invoice_number ?? ""}* paid by *${inv.customer_name ?? ""}* — ${inv.total ?? ""} ${inv.currency ?? ""}`;
    } else if (event_type === "invoice.sent") {
      const inv = data as { invoice_number?: string; customer_name?: string };
      message = `:envelope: Invoice *${inv.invoice_number ?? ""}* sent to *${inv.customer_name ?? ""}*`;
    } else if (event_type === "invoice.overdue") {
      const inv = data as { invoice_number?: string; customer_name?: string };
      message = `:warning: Invoice *${inv.invoice_number ?? ""}* from *${inv.customer_name ?? ""}* is overdue`;
    } else if (event_type === "invoice.viewed") {
      const inv = data as { invoice_number?: string; customer_name?: string };
      message = `:eyes: Invoice *${inv.invoice_number ?? ""}* was viewed by *${inv.customer_name ?? ""}*`;
    }
    return JSON.stringify({ text: message });
  }
  return JSON.stringify({ event: event_type, data, timestamp: new Date().toISOString() });
}

async function deliver(
  webhook: OutgoingWebhook,
  event_type: string,
  data: Record<string, unknown>,
): Promise<{ status_code: number | null; response_body: string | null; error: string | null }> {
  const payload = formatPayload(webhook.preset as WebhookPreset, event_type, data);
  try {
    await validateUrl(webhook.url);
  } catch (err) {
    return {
      status_code: null,
      response_body: null,
      error: err instanceof Error ? err.message : "URL validation failed",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(webhook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: controller.signal,
    });
    const body = await res.text();
    return { status_code: res.status, response_body: body.slice(0, 4000), error: null };
  } catch (err) {
    return {
      status_code: null,
      response_body: null,
      error: err instanceof Error ? err.message : "Delivery failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fire a webhook event to all matching subscribers. Each delivery is logged
 * to webhook_deliveries (success or failure) so the UI can show recent
 * attempts and offer a retry button.
 */
export async function dispatchEvent(
  event_type: string,
  data: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  const webhooks = db
    .query("SELECT * FROM outgoing_webhooks WHERE is_active = 1")
    .all() as OutgoingWebhook[];

  for (const webhook of webhooks) {
    let events: string[] = [];
    try {
      events = JSON.parse(webhook.events) as string[];
    } catch {
      events = [];
    }
    if (!events.includes(event_type)) continue;

    const result = await deliver(webhook, event_type, data);
    const id = crypto.randomBytes(16).toString("hex");
    db.run(
      `INSERT INTO webhook_deliveries
       (id, webhook_id, event_type, payload, status_code, response_body, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        webhook.id,
        event_type,
        formatPayload(webhook.preset as WebhookPreset, event_type, data),
        result.status_code,
        result.response_body,
        result.error,
      ],
    );
  }
}

/**
 * Re-fire a single delivery using the current webhook config. Returns the
 * new delivery record.
 */
export async function retryDelivery(deliveryId: string): Promise<WebhookDelivery | null> {
  const db = getDb();
  const original = getDelivery(deliveryId);
  if (!original) return null;
  const webhook = getWebhook(original.webhook_id);
  if (!webhook) return null;

  let data: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(original.payload || "{}");
    data = parsed.data ?? parsed;
  } catch {
    // Use empty payload — at least the URL gets re-pinged
  }

  const result = await deliver(webhook, original.event_type, data);
  const id = crypto.randomBytes(16).toString("hex");
  db.run(
    `INSERT INTO webhook_deliveries
     (id, webhook_id, event_type, payload, status_code, response_body, error_message, attempt_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      webhook.id,
      original.event_type,
      original.payload,
      result.status_code,
      result.response_body,
      result.error,
      original.attempt_count + 1,
    ],
  );
  return getDelivery(id);
}
