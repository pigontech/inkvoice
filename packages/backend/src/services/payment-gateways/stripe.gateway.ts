import type Stripe from "stripe";
import {
  constructWebhookEvent,
  createCheckoutSession,
  handlePaymentSuccess,
  isStripeConfigured,
  saveMethodFromCheckoutSession,
  chargeOffSession as stripeChargeOffSession,
} from "../stripe.service";
import type {
  CheckoutContext,
  OffSessionContext,
  OffSessionResult,
  PaymentGateway,
  WebhookRequest,
  WebhookResult,
} from "./types";

// Adapter that exposes the existing Stripe service through the gateway
// interface. The underlying `stripe.service.ts` is intentionally left
// unchanged so a downstream overlay, which imports it directly, keeps working.
export const stripeGateway: PaymentGateway = {
  id: "stripe",
  label: "Stripe",
  supportsAutoBill: true,

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
      save_card: ctx.save_card,
      customerId: ctx.customerId,
      consentText: ctx.consentText,
    });
  },

  async handleWebhook({ rawBody, headers }: WebhookRequest): Promise<WebhookResult> {
    const signature = headers["stripe-signature"];
    if (!signature) throw new Error("Missing stripe-signature header");

    const event = await constructWebhookEvent(rawBody, signature);
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      handlePaymentSuccess(session as never);
      await saveMethodFromCheckoutSession(session);
      return { handled: true, recorded: true };
    }
    return { handled: false, recorded: false };
  },

  chargeOffSession(ctx: OffSessionContext): Promise<OffSessionResult> {
    return stripeChargeOffSession(ctx);
  },
};
