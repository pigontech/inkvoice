# Online Payments

Accept payments directly from invoice links using **Stripe** or **PayPal**. Customers click a **Pay Now** button on their shared invoice page and complete payment through the gateway's hosted checkout.

You can enable either gateway or both. Each is configured with its own credentials (below) and turned on per workspace under **Settings → Payments** once its credentials are set. When more than one is enabled, the customer chooses which to pay with on the invoice page.

## Stripe

### 1. Create a Stripe Account

Sign up at [stripe.com](https://stripe.com) if you don't have an account.

### 2. Get Your API Keys

From the Stripe Dashboard, go to **Developers > API Keys** and copy:

- **Publishable key** (`pk_...`)
- **Secret key** (`sk_...`)

### 3. Configure Webhook

Create a webhook endpoint in the Stripe Dashboard:

- **URL**: `https://your-domain.com/api/v1/webhooks/stripe`
- **Events**: `checkout.session.completed`
- Copy the **Signing secret** (`whsec_...`)

### 4. Set Environment Variables

```bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## PayPal

### 1. Create a PayPal App

In the [PayPal Developer Dashboard](https://developer.paypal.com), create a REST app and copy its **Client ID** and **Secret**.

### 2. Configure Webhook

Add a webhook to the app:

- **URL**: `https://your-domain.com/api/v1/webhooks/paypal`
- **Event**: `CHECKOUT.ORDER.APPROVED`
- Copy the **Webhook ID** — Inkvoice uses it to verify webhook signatures

### 3. Set Environment Variables

```bash
PAYPAL_CLIENT_ID=...
PAYPAL_SECRET=...
PAYPAL_WEBHOOK_ID=...
PAYPAL_ENV=live   # or "sandbox" (default) for testing
```

## How It Works

1. You publish an invoice and share the link with your customer
2. The customer opens the link and clicks **Pay Now** (choosing a gateway if more than one is enabled)
3. They're redirected to Stripe Checkout or PayPal to complete payment
4. On successful payment, the gateway's webhook marks the invoice as paid automatically
5. Both you and the customer see the updated status

## Payment Flow

```
Customer opens invoice link
  → Clicks "Pay Now"
  → Stripe / PayPal checkout created
  → Customer completes payment on the gateway
  → Gateway sends webhook to Inkvoice
  → Invoice marked as paid
  → Customer redirected back to the invoice
```

## Partial Payments

Online payments through the public invoice link always pay the full outstanding amount. For partial payments, use the **Record Payment** action from the invoice detail page in the admin UI.

## Saved Cards and Auto-Billing

This is currently a Stripe-only capability, PayPal checkout does not support it.

### Saving a card at checkout

When a customer pays an invoice through Stripe Checkout, they see a "save this card" option alongside the consent text they are agreeing to. If they tick it, Inkvoice stores the card's display details (brand, last 4 digits, expiry) and a Stripe reference token, never the card number itself, for future charges. They can review and remove their saved cards at any time from their client portal (`/portal/:token`), and an admin can do the same from the customer's page in the admin app. Removing a card revokes it at Stripe as well as locally.

A customer's saved card is what makes the **Auto-bill** toggle on a recurring invoice profile (see Recurring Invoices) usable: the toggle stays disabled until the selected customer has at least one saved card.

Turning Stripe off under **Settings → Payments** (the same switch that hides the **Pay Now** button and blocks the public pay endpoint) also stops auto-billing: a recurring profile with Auto-bill on is skipped rather than charged while the gateway is disabled, and the customer is emailed a payment link as if the charge had failed, exactly like a saved card that stops working.

### Retry schedule

If an automatic charge is declined for a retryable reason (for example insufficient funds), Inkvoice retries it, for three attempts in total: the initial attempt when the invoice is generated, a second attempt 1 day after that if it was declined, and a third attempt 3 days after the second if that one was declined too. Once the third attempt also fails, the failure is treated as final and the customer is emailed a payment link so they can pay by hand.

### Strong Customer Authentication and hard declines

Some charges cannot succeed without the customer present, most commonly a bank requiring Strong Customer Authentication (SCA), and some declines are permanent (an expired or blocked card, for instance). Both are treated as final on the very first attempt: there is no retry schedule for them, since retrying would not change the outcome. The customer is immediately emailed a payment link so they can complete the payment themselves, with SCA if required.

### Environment variables and settings

- `PUBLIC_BASE_URL`: the public URL Inkvoice uses to build the payment link it emails a customer after a failed or non-retryable auto-bill charge. Set this to your instance's public URL if it is not already configured for outgoing email links generally.
- `notify_on_auto_bill_failure`: a business setting (off by default) that, when enabled, also emails the company's own address on a terminal (non-retryable) failed or unrecorded auto-bill charge, in addition to the customer's payment-link email. A soft decline with retries still pending does not notify. A successful charge does not notify anyone either, only a terminal failure does.

### Chargebacks

Auto-billing charges the customer's card through your own Stripe account. Chargeback liability, and any dispute process that follows one, sits with the merchant operating that Stripe account, the same as it would for any other Stripe charge you take. Inkvoice does not handle disputes on your behalf.

## Testing

- **Stripe** — use test-mode keys (`sk_test_...`, `pk_test_...`) and Stripe's [test card numbers](https://stripe.com/docs/testing#cards).
- **PayPal** — leave `PAYPAL_ENV=sandbox` and use sandbox app credentials with a [sandbox test account](https://developer.paypal.com/tools/sandbox/accounts/) to simulate payments.
