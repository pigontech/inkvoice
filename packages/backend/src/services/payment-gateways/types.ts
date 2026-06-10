// Provider-agnostic payment gateway abstraction.
//
// Each online payment provider (Stripe, PayPal, …) implements `PaymentGateway`.
// The public invoice flow creates a hosted checkout via `createCheckout` and
// confirms the payment server-side via `handleWebhook`, so the rest of the app
// never needs to know which provider processed a given invoice.

/** Everything a gateway needs to start a hosted checkout for one invoice. */
export interface CheckoutContext {
  invoiceId: string;
  shareToken: string;
  /** Outstanding balance to charge, in the invoice currency. */
  amount: number;
  /** ISO 4217 currency code (e.g. "USD"). */
  currency: string;
  customerEmail: string | null;
  /** Where the provider sends the payer after a successful payment. */
  successUrl: string;
  /** Where the provider sends the payer if they cancel. */
  cancelUrl: string;
}

/** A raw inbound webhook, normalised so gateways can verify it themselves. */
export interface WebhookRequest {
  /** Unparsed request body — required for signature verification. */
  rawBody: string;
  /** Lower-cased request headers. */
  headers: Record<string, string>;
}

export interface WebhookResult {
  /** The event was recognised and processed by this gateway. */
  handled: boolean;
  /** A payment was recorded against an invoice as a result. */
  recorded: boolean;
}

export interface PaymentGateway {
  /** Stable identifier, also the settings-key prefix (`{id}_enabled`). */
  readonly id: string;
  /** Human-readable name shown on the public invoice page. */
  readonly label: string;
  /** True when the provider's credentials are present in the environment. */
  isConfigured(): boolean;
  /** Start a hosted checkout and return the URL to redirect the payer to. */
  createCheckout(ctx: CheckoutContext): Promise<{ url: string }>;
  /** Verify and process an inbound webhook from this provider. */
  handleWebhook(req: WebhookRequest): Promise<WebhookResult>;
}
