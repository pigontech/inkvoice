import type { Context } from "hono";
import { Hono } from "hono";
import { getGateway } from "../services/payment-gateways/registry";

const webhooks = new Hono();

// Extension point: a deployment that terminates gateway webhooks on its own
// endpoint (e.g. with per-workspace routing) disables the core handler by
// registering the message callers should see instead.
let gatewayWebhooksDisabledNotice: string | null = null;

export function setGatewayWebhooksDisabled(notice: string | null): void {
  gatewayWebhooksDisabledNotice = notice;
}

// Shared handler: verify + process an inbound webhook for one gateway.
async function handleGatewayWebhook(c: Context, gatewayId: string) {
  if (gatewayWebhooksDisabledNotice) {
    return c.json({ error: gatewayWebhooksDisabledNotice }, 410);
  }

  const gateway = getGateway(gatewayId);
  if (!gateway?.isConfigured()) {
    return c.json({ error: `${gatewayId} not configured` }, 400);
  }

  const rawBody = await c.req.text();
  try {
    await gateway.handleWebhook({ rawBody, headers: c.req.header() });
    return c.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Webhook error: ${message}` }, 400);
  }
}

webhooks.post("/stripe", (c) => handleGatewayWebhook(c, "stripe"));
webhooks.post("/paypal", (c) => handleGatewayWebhook(c, "paypal"));

export { webhooks };
