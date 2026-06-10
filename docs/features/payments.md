# Online Payments

Accept payments directly from invoice links using Stripe. Customers click a "Pay Now" button on their shared invoice page and complete payment through Stripe Checkout.

## Setup

### 1. Create a Stripe Account

Sign up at [stripe.com](https://stripe.com) if you don't have an account.

### 2. Get Your API Keys

From the Stripe Dashboard, go to **Developers > API Keys** and copy:

- **Publishable key** (`pk_...`)
- **Secret key** (`sk_...`)

### 3. Configure Webhook

Create a webhook endpoint in Stripe Dashboard:

- **URL**: `https://your-domain.com/api/v1/webhooks/stripe`
- **Events**: `checkout.session.completed`
- Copy the **Signing secret** (`whsec_...`)

### 4. Set Environment Variables

```bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

## How It Works

1. You publish an invoice and share the link with your customer
2. The customer opens the link and clicks **Pay Now**
3. They're redirected to Stripe Checkout to complete payment
4. On successful payment, the webhook marks the invoice as paid automatically
5. Both you and the customer see the updated status

## Payment Flow

```
Customer opens invoice link
  → Clicks "Pay Now"
  → Stripe Checkout session created
  → Customer completes payment on Stripe
  → Stripe sends webhook to Inkvoice
  → Invoice marked as paid
  → Customer redirected to success page
```

## Partial Payments

Stripe payments through the public invoice link always pay the full outstanding amount. For partial payments, use the **Record Payment** action from the invoice detail page in the admin UI.

## Testing

Use Stripe test mode keys (`sk_test_...`, `pk_test_...`) during development. Stripe provides [test card numbers](https://stripe.com/docs/testing#cards) for simulating payments.
