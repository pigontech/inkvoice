# Banking and invoice delivery

Banking stores receiving accounts separately from saved email contacts. Accounts default to TND; each has its own currency. There is no currency conversion in this module. Only one receiving account is selected per invoice, independently of its email recipients.

The admin interface manages banks and accounts at `/banking`, and people at `/contacts`. Contacts retain their optional bank association and are selected independently when sharing an invoice. Customers remain separate billing entities.

## Directories

| Resource | List / create | Retrieve / partial update |
| --- | --- | --- |
| Banks | `GET`, `POST /api/v1/banks` | `GET`, `PATCH /api/v1/banks/:id` |
| Accounts | `GET`, `POST /api/v1/bank-accounts` | `GET`, `PATCH /api/v1/bank-accounts/:id` |
| Contacts | `GET`, `POST /api/v1/contacts` | `GET`, `PATCH /api/v1/contacts/:id` |

Typed input/output contracts are in `packages/backend/src/contracts/banking.ts`. Responses follow `{ success: true, data }`; errors retain the existing `{ success: false, error, code?, errors? }` format. Validation errors return 400, missing records 404, conflicting changes 409, and permission failures 403.

Lists accept `page` (default 1), `limit` (default 20, maximum 100), `search`, and `archived=true|false`; account lists also accept `currency`, and account/contact lists accept `bank_id`. Omitted `archived` includes both states. Responses contain `items`, `total`, `page`, `limit`, and `totalPages`.

- Banks: `name`, optional `branch`, `archived`.
- Accounts: `bank_id`, `label`, `holder`, `currency` (default TND), `account_number` (RIB or account identifier), `iban`, `bic`, `instructions`, `is_default`, `archived`. At least an account number or IBAN is required. Identifiers remain strings, including leading zeros. Bank-specific/checksum verification is not performed.
- Contacts: `name`, `email`, optional `phone`, nullable `bank_id`, `archived`. Any contact can optionally be associated with a bank; contacts have no role classification.

PATCH changes only provided fields. Archive/restore via `PATCH {"archived": true|false}`; referenced records are not deleted. Setting an account as default atomically replaces the previous default for that currency. A default must be explicitly cleared or replaced before archival. Archive all active accounts before archiving their bank.

Reading directories requires `invoices:read`; writes require `settings:update`. Scoped API tokens additionally require the corresponding resource scope (`banks`, `bank-accounts`, or `contacts`). Creation is not automatically retried or idempotent; PATCH assignments are repeatable. Do not retry failed requests blindly.

## Invoice payment instructions

Invoice create/update accepts optional `bank_account_id`. Creation without it selects the active matching-currency default, if any; otherwise it retains the legacy company-settings behavior. An explicit null selects no banking instructions. Omitting the field on an update preserves selection. Archived or mismatched-currency selections are rejected.

Only drafts can change selection. Issuance captures payment instructions in the same transaction as assigning the invoice number and marking it sent. `payment_details` on invoice detail responses, HTML/PDF output, and applicable QR payment instructions read that snapshot after issuance. Updating a bank/account does not rewrite issued documents. New, duplicated, consolidated, and recurring-generated invoices resolve the matching-currency default.

Migration imports usable structured company banking settings into an initial account. Existing issued invoices preserve the legacy instructions available at migration time; historical settings overwritten before migration cannot be reconstructed. Legacy settings remain available for quotes and compatibility. Quotes have no new account-selection or contact-sharing behavior.

## Sending and history

`POST /api/v1/invoices/:id/deliveries` requires `invoices:publish` and an `Idempotency-Key` header (1–200 characters). Generate one key per intentional send, retain it across retries, and use a new key only for a new deliberate send. The new UI uses this endpoint; the legacy `/send` endpoint remains compatible and is not safe for automatic retries.

Customer email, with explicit CC and separate private copies:

```json
{
  "kind": "customer",
  "to": "customer@example.com",
  "recipients": [
    { "contact_id": "bank-manager-id", "mode": "cc" },
    { "contact_id": "accountant-id", "mode": "private" }
  ],
  "message": "Please include this invoice in this month's accounts."
}
```

Private copies only, for an issued non-voided invoice:

```json
{
  "kind": "private",
  "recipients": [{ "contact_id": "accountant-id", "mode": "private" }],
  "message": "For your records."
}
```

Both variants accept optional `subject`, `message`, `from`, and `reply_to`. Recipient selection is explicit; contacts and bank associations do not automatically add recipients. Repeated email addresses within one request, including the customer, are rejected before issuing/sending.

Private copies go to separate SMTP envelopes and contain the normal invoice PDF, optional note, and public invoice link. Sharing activates the public link if necessary; recipients can access the public invoice page. Private sharing does not email the customer or change payment status. CC recipients participate in the customer email and their addresses are visible to its recipients. Public URLs prefer `PUBLIC_BASE_URL`, falling back to a valid request Origin.

The response contains an `InvoiceDelivery` with individual message outcomes. `GET /api/v1/invoices/:id/deliveries?page=1&limit=20` requires invoice read permission and returns paginated history. Recipient names/addresses are snapshots, unaffected by later contact changes. History covers this new workflow, not earlier legacy sends.

### Retry and failure semantics

The server atomically claims the key with a unique constraint and stores a hash of the parsed payload, invoice, and actor. Matching completed requests replay their recorded result. A changed payload or in-flight duplicate returns 409. Keys and receipts are retained with the invoice, with no automatic expiry.

Each message records `pending`, `accepted`, `failed`, or `unknown`, accepted/rejected addresses, and any SMTP message ID. Accepted means accepted by the mail server, not confirmed inbox delivery. Partial recipient rejection is shown explicitly. Preparation failures are recorded before any messages are sent. SMTP timeouts/crashes may leave an unknown outcome; attempts pending longer than ten minutes are displayed as unknown. Neither uncertain attempts nor successful messages are retried automatically.

The UI's prepare-resend action includes only failed/rejected recipients and asks for a new explicit send. Failed CC recipients can receive private copies without resending the successful customer email. Current contact addresses are shown for review before that new send. For unknown outcomes, check provider logs before intentionally creating another send.

## PDF runtime and backups

Private attachments render the existing invoice HTML template using Chromium through `playwright-core`, with JavaScript, frames, and external network/file resources blocked. Inline styles, data-URL images/fonts and system fonts are available; externally hosted template assets are intentionally not fetched. Docker installs Chromium and fonts; `CHROMIUM_EXECUTABLE_PATH` can select an existing local installation. For development/test setup, run `bunx playwright-core install chromium` (Linux CI: `--with-deps chromium`).

SQLite backups/restores include banking, contacts, immutable payment instructions, and sending history. JSON exports include the new records, and business-data wipes remove them in foreign-key order. Take a normal backup before rollout; downgrading requires restoring a compatible snapshot rather than dropping new data.
