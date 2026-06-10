import {
  constructWebhookEvent,
  createCheckoutSession,
  handlePaymentSuccess,
  isStripeConfigured,
} from "../stripe.service";
import type { CheckoutContext, PaymentGateway, WebhookRequest, WebhookResult } from "./types";

// Adapter that exposes the existing Stripe service through the gateway
// interface. The underlying `stripe.service.ts` is intentionally left
// unchanged so a downstream overlay, which imports it directly, keeps working.
export const stripeGateway: PaymentGateway = {
  id: "stripe",
  label: "Stripe",

  isConfigured: isStripeConfigured,

  createCheckout(ctx: CheckoutContext): Promise<{ url: string }> {
    return createCheckoutSession({
      invoiceId: ctx.invoiceId,
      shareToken: ctx.shareToken,
      amount: ctx.amount,
      currency: ctx.currency,
      customerEmail: ctx.customerEmail,
      successUrl: ctx.successUrl,
      cancelUrl: ctx.cancelUrl,
    });
  },

  async handleWebhook({ rawBody, headers }: WebhookRequest): Promise<WebhookResult> {
    const signature = headers["stripe-signature"];
    if (!signature) throw new Error("Missing stripe-signature header");

    const event = await constructWebhookEvent(rawBody, signature);
    if (event.type === "checkout.session.completed") {
      handlePaymentSuccess(event.data.object as never);
      return { handled: true, recorded: true };
    }
    return { handled: false, recorded: false };
  },
};
