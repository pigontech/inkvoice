import type Stripe from "stripe";
import { todayIso } from "../utils/date";
import { getEnv } from "../utils/env";
import { logger } from "../utils/logger";
import { recordPayment } from "./payment.service";

// The `stripe` package is heavy to load (~17ms on Bun); defer it until first
// use so it stays out of the cold-start path for self-hosted instances that
// never enable Stripe.
let stripeClientPromise: Promise<Stripe> | null = null;

/**
 * Extension point for deployments where the Stripe account is not a process-wide
 * env var. The cloud overlay registers a resolver that decrypts the current
 * tenant's own key, so one charge engine serves both deployments. Self-hosted
 * never registers one and keeps the env singleton below.
 */
export type StripeClientResolver = () => Promise<Stripe | null>;
let clientResolver: StripeClientResolver | null = null;
export function setStripeClientResolver(r: StripeClientResolver | null): void {
  clientResolver = r;
}

export type StripeConfiguredChecker = () => boolean;
let configuredChecker: StripeConfiguredChecker | null = null;
export function setStripeConfiguredChecker(c: StripeConfiguredChecker | null): void {
  configuredChecker = c;
}

export function isStripeConfigured(): boolean {
  if (configuredChecker) return configuredChecker();
  const env = getEnv();
  return !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

export function getStripe(): Promise<Stripe> {
  if (clientResolver) {
    return clientResolver().then((client) => {
      if (!client) throw new Error("Stripe is not configured for this workspace");
      return client;
    });
  }
  if (stripeClientPromise) return stripeClientPromise;
  stripeClientPromise = (async () => {
    const env = getEnv();
    const { default: StripeMod } = await import("stripe");
    return new StripeMod(env.STRIPE_SECRET_KEY);
  })();
  return stripeClientPromise;
}

export async function createCheckoutSession(opts: {
  invoiceId: string;
  shareToken: string;
  amount: number;
  currency: string;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
  save_card?: boolean;
  customerId?: string | null;
  consentText?: string | null;
}): Promise<{ url: string }> {
  const stripe = await getStripe();
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: opts.currency.toLowerCase(),
          unit_amount: Math.round(opts.amount * 100),
          product_data: { name: `Invoice Payment` },
        },
        quantity: 1,
      },
    ],
    customer_email: opts.customerEmail || undefined,
    ...(opts.save_card
      ? {
          customer_creation: "always" as const,
          payment_intent_data: { setup_future_usage: "off_session" as const },
        }
      : {}),
    metadata: {
      invoice_id: opts.invoiceId,
      share_token: opts.shareToken,
      ...(opts.save_card
        ? {
            save_card: "1",
            customer_id: opts.customerId ?? "",
            consent_text: (opts.consentText ?? "").slice(0, 480),
          }
        : {}),
    },
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });

  return { url: session.url! };
}

export async function constructWebhookEvent(
  payload: string,
  signature: string,
): Promise<Stripe.Event> {
  const env = getEnv();
  const stripe = await getStripe();
  return stripe.webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
}

export function handlePaymentSuccess(session: Stripe.Checkout.Session): void {
  const invoiceId = session.metadata?.invoice_id;
  if (!invoiceId) return;

  const amount = (session.amount_total || 0) / 100;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  recordPayment(invoiceId, {
    amount,
    payment_date: todayIso(),
    method: "card",
    reference: paymentIntentId || undefined,
    notes: "Paid via Stripe",
  });
}

/**
 * Persist the card a payer opted to save during Checkout. A no-op unless the
 * session carries save_card, so both webhook paths can call it unconditionally.
 * Never throws: a capture failure must not fail the webhook that is confirming
 * a real payment.
 */
export async function saveMethodFromCheckoutSession(
  session: Stripe.Checkout.Session,
): Promise<void> {
  if (session.payment_status !== "paid") return;
  if (session.metadata?.save_card !== "1") return;

  const customerId = session.metadata?.customer_id;
  if (!customerId) return;

  try {
    const stripe = await getStripe();
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!paymentIntentId) return;

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const methodId =
      typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
    const gatewayCustomerId =
      typeof intent.customer === "string" ? intent.customer : intent.customer?.id;
    if (!methodId || !gatewayCustomerId) return;

    const method = await stripe.paymentMethods.retrieve(methodId);
    const { saveMethod } = await import("./customer-payment-method.service");
    saveMethod({
      customerId,
      gatewayCustomerId,
      gatewayMethodId: methodId,
      brand: method.card?.brand ?? null,
      last4: method.card?.last4 ?? null,
      expMonth: method.card?.exp_month ?? null,
      expYear: method.card?.exp_year ?? null,
      consentText: session.metadata?.consent_text || null,
    });
  } catch (err) {
    // The payment itself is already recorded by the caller. Losing the saved
    // card only costs the customer a re-entry next time.
    logger.error({ err, sessionId: session.id }, "Could not save payment method from checkout");
  }
}
