# Auto-billing: saved payment methods + off-session charge — Design

Date: 2026-09-04
Status: Approved (design review)
Repo: `pigontech/inkvoice` (OSS, MIT) with a thin `pigontech/inkvoice-cloud` overlay
Roadmap: [Auto-billing: saved payment methods + off-session charge for recurring invoices](https://app.notion.com/p/378d102d803e8158adf9ecef7c54730a)

## Motivation

Recurring invoices exist (`recurring.service.ts` + the hourly `scheduler.ts`)
but cannot auto-charge. Invoice Ninja, FreshBooks and Zoho all auto-bill a
stored card when a subscription invoice fires; without it "recurring" covers
only half the subscription use-case. This is a Tier 1 competitor gap.

Tracing the card through the code surfaced four facts that reshape its scope.

**There are two independent Stripe integrations, not one.** The OSS app charges
through `services/stripe.service.ts` behind the `PaymentGateway` registry, with a
single merchant configured by `STRIPE_SECRET_KEY`. The cloud overlay charges
through `cloud/routes/connect.ts` using per-tenant bring-your-own keys encrypted
at rest, because Pigon cannot hold a Stripe account or act as a card merchant
and Stripe Connect is therefore not viable. An off-session charge engine must
resolve *which* Stripe client it is charging on.

**Recurring generation produces a draft.** `createInvoice` hardcodes
`status = 'draft'` (`invoice.service.ts:321`), and `auto_send` is written to
`recurring_invoices` but read nowhere — `generateInvoice` creates the draft and
stops. A draft cannot be charged, and `recordPayment` refuses drafts outright,
so a card charged against one would capture money that cannot be recorded. The
card's stated fallback, "email payment link as today", also does not exist:
today the recurring path emails nothing.

**Sent invoices never get a share link.** Found while planning, and verified by
running the route's own sequence against a real database: `POST /invoices/:id/send`
calls `publishInvoice` before `markSent`, but `publishInvoice` (`invoice.service.ts:548`)
refuses anything still in `draft`. A draft therefore ends up `status = 'sent'`
with `is_published = 0` and `share_token = NULL`, and the delivery email's
`public_url` is built from the pre-call object, so it is `null`. Every first-time
send emails an invoice with no link to view or pay it. This is a live defect in
the main send path, and it is the exact link every fallback below depends on.

**In cloud mode the OSS gateway webhooks are disabled.** `init.ts:165` calls
`setGatewayWebhooksDisabled(...)`, so `routes/webhooks.ts` returns 410 and
`stripeGateway.handleWebhook` never runs for a tenant. Any card-persistence
logic hung off the OSS webhook will not fire on cloud.

## Decisions (from design review)

| Question | Decision |
|---|---|
| Surface | Both. One engine in OSS; the cloud overlay supplies its per-tenant Stripe client through a resolver hook. |
| Draft gap | Fixed as Phase 0 of this work, not a separate card. Ships standalone value even if auto-bill slips. |
| Finalize scope | Finalize only when `auto_send = 1` or `auto_bill = 1`. Default profiles keep producing drafts, so no existing user loses a review step. |
| Card capture | Opt-in at the existing hosted Checkout (`setup_future_usage`). The portal lists and removes methods; it does not capture. |
| Dunning | `auto_bill_attempts` log with a fixed retry schedule (+1d, +3d, +5d, cap 3), driven by the existing hourly scheduler. No new cron, no settings UI. |
| Abstraction | `PaymentGateway` gains optional `saveMethod` / `chargeOffSession`. Stripe implements them; PayPal leaves them undefined. |
| Cloud checkout | `connect.ts` keeps its own Checkout path in v1. The resolver feeds only the auto-bill engine. Converging the two checkout paths is later cleanup. |

## Architecture

### Stripe client resolution

`stripe.service.ts` gains a resolver hook alongside its existing env-key
singleton:

```ts
export type StripeClientResolver = () => Promise<Stripe | null>;
let clientResolver: StripeClientResolver | null = null;
export function setStripeClientResolver(r: StripeClientResolver | null): void;
```

`getStripe()` consults the resolver when one is registered and otherwise builds
from `STRIPE_SECRET_KEY` as today. `isStripeConfigured()` gains a parallel hook
so cloud can report "configured" from an active `payment_credentials` row
rather than from env.

OSS never registers a resolver, so self-hosted behaviour is unchanged. The
cloud overlay registers one in `cloud/init.ts`, next to the existing
`setRecurringLimitChecker` / `setTenantSmtpResolver` / `setPortalOnlinePaymentChecker`
calls, backed by `loadStripeForTenant` lifted out of `connect.ts` into a shared
`cloud/services/stripe-tenant.ts`. This is the third use of an established
extension pattern, so the OSS→overlay sync agent stays mechanical.

### Gateway capability

`services/payment-gateways/types.ts`:

```ts
export interface SavedMethodRef {
  gatewayCustomerId: string;
  gatewayMethodId: string;
  brand?: string; last4?: string; expMonth?: number; expYear?: number;
}

export interface OffSessionResult {
  status: "succeeded" | "requires_action" | "soft_failed" | "hard_failed";
  reference?: string;      // pi_...
  errorCode?: string;
  errorMessage?: string;
}

export interface PaymentGateway {
  // … existing members unchanged …
  readonly supportsAutoBill?: boolean;
  saveMethod?(session: unknown): Promise<SavedMethodRef | null>;
  chargeOffSession?(ctx: OffSessionContext): Promise<OffSessionResult>;
}
```

The registry gains `getAutoBillGateways()`. The recurring pipeline skips any
profile whose gateway does not declare `supportsAutoBill`.

## Data model

Four OSS migrations, appended to `MIGRATIONS` in `database/migrations.ts`:
27 `recurring_auto_bill` (landed with Phase 0, which first needs the column),
28 `customer_payment_methods`, 29 `auto_bill_attempts`,
30 `payments_reference_dedupe`. Cloud tenant databases run OSS `runMigrations()`
before cloud migrations (`tenant-migrations.ts:329`), so these reach every
tenant with no overlay migration.

```sql
-- 28: saved payment methods. Tokens and display metadata only, never a PAN.
CREATE TABLE customer_payment_methods (
  id                  TEXT PRIMARY KEY,
  customer_id         TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  gateway             TEXT NOT NULL DEFAULT 'stripe',
  gateway_customer_id TEXT NOT NULL,          -- cus_...
  gateway_method_id   TEXT NOT NULL,          -- pm_...
  brand TEXT, last4 TEXT, exp_month INTEGER, exp_year INTEGER,
  is_default          INTEGER NOT NULL DEFAULT 0,
  consent_text        TEXT,                   -- mandate copy shown at capture
  consent_at          TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX ux_cpm_gateway_method
  ON customer_payment_methods(gateway, gateway_method_id);
CREATE INDEX idx_cpm_customer ON customer_payment_methods(customer_id);

-- 27: opt a recurring profile into auto-billing.
ALTER TABLE recurring_invoices ADD COLUMN auto_bill INTEGER NOT NULL DEFAULT 0;

-- 29: dunning log and audit trail.
CREATE TABLE auto_bill_attempts (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  recurring_id      TEXT,
  payment_method_id TEXT,
  attempt_no        INTEGER NOT NULL,
  status            TEXT NOT NULL,   -- succeeded|requires_action|soft_failed|hard_failed
  gateway_reference TEXT,
  error_code        TEXT,
  error_message     TEXT,
  next_retry_at     TEXT,            -- NULL = terminal
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_aba_retry ON auto_bill_attempts(next_retry_at)
  WHERE next_retry_at IS NOT NULL;
CREATE UNIQUE INDEX ux_aba_invoice_attempt
  ON auto_bill_attempts(invoice_id, attempt_no);

-- 30: payment dedupe, currently cloud-only (tenant-migrations.ts:172).
-- Promoted to OSS so both deployments share one idempotency guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_invoice_reference
  ON payments(invoice_id, reference) WHERE reference IS NOT NULL;
```

Migration 30 can fail on an existing OSS database that already holds duplicate
`(invoice_id, reference)` rows. The migration deduplicates first, keeping the
lowest `rowid` per pair, and logs how many rows it removed.

`consent_text` stores the mandate copy verbatim per method. It is the record
that answers a customer disputing an off-session charge, so it is captured at
save time rather than reconstructed from current settings later.

## Phase 0 — finalize and send

Extract the body of `routes/invoices.ts:445` (`POST /:id/send`) into
`services/invoice-send.service.ts`:

```ts
export async function sendInvoiceEmail(invoiceId: string, opts?: {
  to?: string; subject?: string; message?: string; from?: string;
  replyTo?: string; attachEinvoice?: boolean; origin?: string;
}): Promise<{ success: boolean; error?: string }>;
```

The route becomes a thin HTTP wrapper that maps the result to its existing
status codes. Behaviour over HTTP must not change: auto-publish, auto-mark-sent,
the e-invoice attachment path, and the 400/502 error mapping all move verbatim.
`origin` becomes a parameter because the scheduler has no request to read it
from; it falls back to a new `PUBLIC_BASE_URL` env var, and the public URL is
omitted when neither is available.

`generateInvoice` then, after `createInvoice` succeeds and only when
`auto_send = 1` or `auto_bill = 1`:

1. `publishInvoice` + `markSent` to assign a real invoice number and leave
   `draft`.
2. When `auto_bill = 1`, hand off to Phase 2 before emailing (a successful
   charge means the customer receives a paid invoice, not a payment request).
3. When `auto_send = 1` and the invoice is still unpaid, `sendInvoiceEmail`.

Email failure must never roll back a generated invoice or block the scheduler:
it is caught, logged, and recorded on the profile. Generation and delivery are
separate concerns.

### The sync-to-async ripple

`generateInvoice` and `processAllDue` are both synchronous today, and sending
email and charging a card are both asynchronous. Both become `async`:

- `generateInvoice(id): string | null` → `Promise<string | null>`
- `processAllDue(): {generated, errors}` → `Promise<{generated, errors, charged, chargeFailed}>`

Two call sites follow: `routes/recurring.ts:63` (the manual "generate now"
endpoint, already in an async handler) and `scheduler.ts`'s `runScheduledTasks`
(already async and already `await`ing `processAllReminders`). `recurring-cron.test.ts`
needs `await` added at its call sites.

The database writes inside `generateInvoice` stay synchronous and complete
before any await, so the existing invoice-number transaction is unaffected. The
charge is attempted only after generation has fully committed.

## Phase 1 — capture at checkout

`createCheckoutSession` gains `save_card?: boolean`. When set:

```ts
customer_creation: "always",
payment_intent_data: { setup_future_usage: "off_session" },
metadata: { invoice_id, share_token, save_card: "1", customer_id }
```

`customer_id` is the Inkvoice customer, needed to attach the saved method to
the right record on the way back.

Persistence lives in `services/customer-payment-method.service.ts`:

```ts
export async function saveMethodFromCheckoutSession(
  session: Stripe.Checkout.Session,
): Promise<void>;
```

It reads `save_card` and `customer_id` from metadata, retrieves the
PaymentIntent to get `payment_method` and `customer`, fetches the card's brand
and last4, and upserts a `customer_payment_methods` row marked default when the
customer has none. It is a no-op when `save_card` is absent, so it is safe to
call unconditionally.

Both webhook paths call this one function:

- OSS: `stripeGateway.handleWebhook`, in the existing
  `checkout.session.completed` branch.
- Cloud: `connect.ts`'s tenant-scoped webhook and its redirect-confirm
  fast-path, because OSS gateway webhooks return 410 in cloud mode.

The wiring is duplicated; the logic is not.

The public invoice page gains the opt-in checkbox with explicit mandate copy,
new i18n keys in all five OSS locales (`en.ts`, `tr.ts`, `de.ts`, `es.ts`,
`fr.ts`); cloud's `cloud-*.ts` locale files are inert and must not be used:

> Save this card and authorise {{company}} to charge it for future invoices.
> You can remove it at any time from your customer portal.

The rendered string is what gets stored in `consent_text`.

## Phase 2 — the off-session charge

`services/auto-bill.service.ts`:

```ts
export async function attemptAutoBill(
  invoiceId: string,
  opts: { recurringId?: string; attemptNo?: number },
): Promise<OffSessionResult>;
```

Preconditions, each a clean skip rather than an error: invoice exists, is not
draft/voided/paid/complete, has a positive balance, its customer has a default
saved method, and that method's gateway declares `supportsAutoBill`.

The Stripe implementation of `chargeOffSession`:

```ts
stripe.paymentIntents.create({
  amount: Math.round(balanceDue * 100),
  currency: invoice.currency.toLowerCase(),
  customer: method.gateway_customer_id,
  payment_method: method.gateway_method_id,
  off_session: true,
  confirm: true,
  metadata: { invoice_id: invoiceId, auto_bill: "1" },
}, { idempotencyKey: `autobill:${invoiceId}:${attemptNo}` });
```

The amount is always derived server-side from the invoice balance, never
accepted from a caller — the same trust model `connect.ts` documents for
Checkout. Between the idempotency key, `ux_aba_invoice_attempt`, and
`ux_payments_invoice_reference`, a double scheduler tick cannot double-charge.

On success, `recordPayment(invoiceId, { amount, method: "card", reference: pi.id,
notes: "Auto-billed via Stripe" })`. A captured charge that cannot be recorded
is logged at error level with the invoice id and reference, matching the
existing handling in `connect.ts:99` — money must never disappear quietly.

### Failure classification

| Stripe outcome | Classification | Handling |
|---|---|---|
| `succeeded` | `succeeded` | Record payment; invoice becomes paid |
| `authentication_required` | `requires_action` | **Terminal.** Off-session retry can never clear SCA. Email the payment link at once |
| `card_declined`, `expired_card`, `incorrect_number`, `invalid_account`, `card_velocity_exceeded` | `hard_failed` | Terminal. Notify admin, email the payment link |
| `insufficient_funds`, `processing_error`, `issuer_not_available`, `try_again_later`, rate limits, network errors | `soft_failed` | Retry at +1d, +3d, +5d; terminal after attempt 3 |
| anything unrecognised | `soft_failed` | Treated as retryable; the code is logged so the table can grow |

Every outcome writes an `auto_bill_attempts` row. On any terminal failure the
invoice is left `sent` with its payment link emailed, so the customer can always
pay by hand — that is the degradation path the roadmap card assumed already
existed.

Admin notification adds no new channel. It mirrors `notifyInvoiceViewed`
(`invoice-view.service.ts:12`) exactly: `logActivity` for the in-app
notifications bell, `dispatchEvent("invoice.auto_bill_failed", …)` for the
outgoing webhook, and an opt-in email to `company_email` behind a new
`notify_on_auto_bill_failure` setting (added to the allowlist in
`routes/settings.ts`). All three are best-effort; a notification failure never
affects the charge outcome or the scheduler.

### Scheduling

`processAutoBillRetries()` in `auto-bill.service.ts` selects attempts whose
`next_retry_at <= now` and re-runs `attemptAutoBill` with the next attempt
number. `scheduler.ts`'s `runScheduledTasks` calls it after `processAllDue()`,
in its own try/catch so a Stripe outage cannot stop reminders. The hourly tick
means a "+1d" retry fires within an hour of its due time, which is ample.

## Phase 3 — management surfaces

Portal (`routes/public.ts`, portal-token scoped):

- `GET /portal/:token/payment-methods` — brand, last4, expiry, default flag.
  Never a gateway id.
- `DELETE /portal/:token/payment-methods/:id` — detaches at Stripe first, then
  deletes the row. A detach failure returns 502 and keeps the row, so local
  state never claims a card is gone while Stripe still holds it.

Admin: the customer detail page lists saved methods read-only with a remove
action; the recurring form gains the `auto_bill` toggle, disabled with an
explanation when the customer has no saved method or the gateway cannot
auto-bill.

## Security and compliance

- No PAN, CVV or expiry-with-number ever reaches Inkvoice. Only Stripe tokens
  and display metadata are stored.
- Charge amounts are always server-derived from the invoice balance.
- Consent is captured explicitly, stored verbatim per method, and revocable by
  the customer from the portal without contacting the merchant.
- Removing a method detaches it at Stripe, so revocation is real rather than
  cosmetic.
- Portal endpoints stay behind the existing `portal_tokens` + `portal_enabled`
  checks and never expose gateway identifiers.
- Chargeback and merchant liability sit with the tenant, not with Pigon. On
  cloud this is already true by construction (BYO keys, tenant is the
  merchant). It is stated in the docs so nobody assumes otherwise.

## Testing

Following the discipline of `stripe-byo.test.ts`: mock the Stripe SDK and
nothing else. Real database, real routing, real payment recording.

`packages/backend/src/tests/auto-bill.test.ts`:

- Successful charge records a payment and moves the invoice to paid.
- Soft decline writes an attempt with `next_retry_at`; a later tick retries and
  can succeed.
- Attempt 3 soft decline is terminal, notifies, and emails the payment link.
- Hard decline is terminal on the first attempt.
- `authentication_required` is terminal on the first attempt and emails at once.
- Two scheduler ticks in the same window produce exactly one charge and one
  payment row.
- A customer with no saved method is skipped, leaving no attempt row.
- A gateway without `supportsAutoBill` is skipped.
- Portal delete detaches at Stripe; a detach failure leaves the row intact.

`recurring-cron.test.ts` is extended for the Phase 0 behaviour: default profiles
still generate drafts; `auto_send` profiles generate a numbered `sent` invoice
and email it; an email failure leaves the invoice generated and the scheduler
running.

Cloud gets `tests/auto-bill-tenant.test.ts` proving the resolver charges on the
tenant's own key and that a saved method in tenant A is invisible to tenant B.

## Sequencing

Phase 0 ships alone and is worth shipping alone: recurring invoices that
silently accumulate drafts nobody sends is arguably a worse defect than the
missing auto-charge. Phases 1–3 then land in order, each behind the existing
per-gateway settings toggle, with no feature flag of their own — a profile only
auto-bills when a merchant sets `auto_bill` and a customer has saved a card, so
the blast radius is opt-in on both sides.

## Out of scope

- PayPal reference transactions. The interface leaves the door open; no
  implementation.
- Stripe Connect or any platform-merchant model. Not viable for Pigon.
- Admin-initiated card capture, ACH/SEPA debit, configurable retry schedules,
  and per-customer dunning rules. All revisitable once real failure data exists.
- Converging cloud's `connect.ts` Checkout onto the OSS gateway path.
