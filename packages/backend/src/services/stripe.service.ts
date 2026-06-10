import type Stripe from "stripe";
import { todayIso } from "../utils/date";
import { getEnv } from "../utils/env";
import { recordPayment } from "./payment.service";

// The `stripe` package is heavy to load (~17ms on Bun); defer it until first
// use so it stays out of the cold-start path for self-hosted instances that
// never enable Stripe.
let stripeClientPromise: Promise<Stripe> | null = null;

export function isStripeConfigured(): boolean {
  const env = getEnv();
  return !!env.STRIPE_SECRET_KEY;
}

function getStripe(): Promise<Stripe> {
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
    metadata: {
      invoice_id: opts.invoiceId,
      share_token: opts.shareToken,
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
