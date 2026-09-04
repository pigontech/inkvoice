# Auto-billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a recurring invoice profile automatically charge a customer's saved card when it fires, falling back to an emailed payment link when the charge cannot succeed.

**Architecture:** One off-session charge engine in the OSS repo, reached through two optional members on the existing `PaymentGateway` interface. The Stripe client is resolved through a hook so the cloud overlay can supply a per-tenant bring-your-own key without duplicating the engine. Cards are captured as an opt-in on the existing hosted Checkout; the customer portal only lists and revokes them.

**Tech Stack:** Bun, Hono, SQLite (`bun:sqlite`), Stripe Node SDK v22, React + Vite frontend, `bun test` for tests, Biome for lint.

## Global Constraints

- **Design spec:** `docs/superpowers/specs/2026-09-04-auto-billing-design.md`. Read it before Task 1.
- **Repo:** Tasks 1-12 are in `inkvoice/` (OSS, MIT). Task 13 is in `inkvoice-cloud/` (private). These are separate git repos, commit inside the relevant subfolder, never at the `inkvoice-mono/` level.
- **No PAN, CVV, or raw card number is ever stored, logged, or transmitted by Inkvoice.** Only Stripe tokens (`cus_…`, `pm_…`, `pi_…`) and display metadata (brand, last4, expiry month/year).
- **Charge amounts are always derived server-side** from the invoice balance. Never accept an amount from a request body.
- **Never use em dashes or en dashes** in code comments, copy, commit messages, or documentation. Use commas, periods, or parentheses.
- **Commit messages: title line only, no body. No `Co-Authored-By` trailer.**
- **Commit directly to `main`. Do not open pull requests.**
- **i18n keys are snake_case** (`namespace.descriptive_key`), and interpolation uses `{{variable}}`. Match the existing keys in each namespace.
- **i18n:** the OSS app has five locales, `en.ts`, `tr.ts`, `de.ts`, `es.ts`, `fr.ts` in `packages/frontend/src/i18n/`. `tr.ts`, `es.ts`, `de.ts` and `fr.ts` each declare `const x: TranslationKeys`, so a key added to `en.ts` alone fails typecheck in all four. Every new string needs a key in all five. The cloud repo's `cloud-*.ts` locale files are inert and must not be used.
- **Test command:** `bun test` from `packages/backend/`, or `bun run test` from the OSS repo root. Full gate: `bun run check` (lint + typecheck + test).
- **Verification:** run the actual command and read the output before claiming a step passed.

---

## File Structure

**Created (OSS):**
| File | Responsibility |
|---|---|
| `packages/backend/src/services/invoice-send.service.ts` | Build and send the invoice delivery email. Callable from a route or the scheduler. |
| `packages/backend/src/services/customer-payment-method.service.ts` | CRUD for `customer_payment_methods`, plus persisting a method from a completed Checkout session. |
| `packages/backend/src/services/auto-bill.service.ts` | Charge attempts, failure classification, retry scheduling, notifications. |
| `packages/backend/src/tests/auto-bill.test.ts` | Full engine coverage against a mocked Stripe SDK. |
| `packages/frontend/src/components/PaymentMethodList.tsx` | Shared saved-card list used by the portal and the admin customer page. |

**Modified (OSS):**
| File | Change |
|---|---|
| `packages/backend/src/database/migrations.ts` | Migrations 27-30. |
| `packages/backend/src/routes/invoices.ts:445` | `POST /:id/send` becomes a thin wrapper over the new service; publish ordering fixed. |
| `packages/backend/src/services/invoice.service.ts` | `publishInvoice` accepts a freshly-sent invoice. |
| `packages/backend/src/services/recurring.service.ts` | `auto_bill` column, async `generateInvoice`/`processAllDue`, finalize and hand off. |
| `packages/backend/src/services/stripe.service.ts` | Client resolver hook, `save_card` on checkout, off-session charge. |
| `packages/backend/src/services/payment-gateways/types.ts` | Optional `saveMethod` / `chargeOffSession` / `supportsAutoBill`. |
| `packages/backend/src/services/payment-gateways/stripe.gateway.ts` | Implements the new members. |
| `packages/backend/src/services/payment-gateways/registry.ts` | `getAutoBillGateways()`. |
| `packages/backend/src/services/scheduler.ts` | Calls `processAutoBillRetries()`. |
| `packages/backend/src/routes/public.ts` | `save_card` passthrough, portal payment-method endpoints. |
| `packages/backend/src/routes/recurring.ts` | `auto_bill` in the schema, `await` on generate. |
| `packages/backend/src/routes/settings.ts` | `notify_on_auto_bill_failure` in the allowlist. |
| `packages/backend/src/tests/recurring-cron.test.ts` | `await` at call sites, Phase 0 coverage. |
| `packages/frontend/src/pages/PublicInvoice.tsx` | Save-card opt-in checkbox and mandate copy. |
| `packages/frontend/src/pages/ClientPortal.tsx` | Saved-methods section. |
| `packages/frontend/src/pages/CustomerView.tsx` | Saved-methods section (read-only + remove). |
| `packages/frontend/src/pages/RecurringInvoiceForm.tsx` | `auto_bill` toggle. |
| `packages/frontend/src/i18n/{en,tr,de,es,fr}.ts` | New keys. |
| `docs/features/recurring.md`, `docs/features/payments.md` | Document auto-billing. |

**Modified (cloud, Task 13):**
`packages/backend/src/cloud/init.ts`, `packages/backend/src/cloud/routes/connect.ts`, new `packages/backend/src/cloud/services/stripe-tenant.ts`, new `packages/backend/src/tests/auto-bill-tenant.test.ts`.

---

## Phase 0, Finalize and send

### Task 1: Fix the publish ordering so sent invoices get a share token

A draft invoice sent through `POST /invoices/:id/send` today ends up `status = 'sent'` but `is_published = 0` with `share_token = NULL`, because `publishInvoice` (`invoice.service.ts:543`) rejects anything still in `draft` and the route calls it *before* `markSent`. The delivery email's `public_url` is built from the stale pre-call object, so it is `null`. Customers receive an invoice email with no link to view or pay. Every later phase depends on that link existing.

**Files:**
- Modify: `packages/backend/src/routes/invoices.ts:459-467`
- Test: `packages/backend/src/tests/invoice-send.test.ts` (create)

**Interfaces:**
- Consumes: `publishInvoice(id: string): InvoiceWithItems | null`, `markSent(id: string): InvoiceWithItems | null`, `getInvoice(id: string): InvoiceWithItems | null` from `services/invoice.service.ts`
- Produces:
  ```ts
  export function finaliseForSending(id: string): InvoiceWithItems | null;
  ```
  Task 2's `sendInvoiceEmail` and Task 3's `generateInvoice` both call it, so the ordering rule lives in exactly one place. Guarantee: after it returns, the invoice has `status = 'sent'`, `is_published = 1`, and a non-null `share_token`.

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/tests/invoice-send.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import { unlinkSync } from "node:fs";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { createInvoice, finaliseForSending, getInvoice } from "../services/invoice.service";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-invoice-send.db";
let customerId: string;

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "invoicesendtestpass";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  resetEnvCache();
  initDatabase();
  runMigrations();
  await seed();
  customerId = crypto.randomBytes(16).toString("hex");
  getDb().run("INSERT INTO customers (id, name, email) VALUES (?, ?, ?)", [
    customerId, "Send Co", "billing@send.test",
  ]);
});

afterAll(() => {
  closeDatabase();
  for (const s of ["", "-wal", "-shm"]) {
    try { unlinkSync(TEST_DB + s); } catch {}
  }
});

function newDraft() {
  return createInvoice({
    customer_id: customerId,
    issue_date: "2026-09-04",
    currency: "USD",
    items: [{ description: "Work", quantity: 1, unit_price: 100 }],
  });
}

describe("finaliseForSending", () => {
  test("a draft becomes sent, published, and share-linked", () => {
    const inv = newDraft();
    expect(inv.status).toBe("draft");
    expect(inv.is_published).toBe(0);
    expect(inv.share_token).toBeNull();

    const finalised = finaliseForSending(inv.id)!;
    expect(finalised.status).toBe("sent");
    expect(finalised.is_published).toBe(1);
    expect(finalised.share_token).toBeTruthy();
    // It returns the post-write state, not the pre-write row the caller had.
    expect(finalised.invoice_number).toBe(getInvoice(inv.id)!.invoice_number);
  });

  test("it is idempotent and keeps the existing share token", () => {
    const inv = newDraft();
    const first = finaliseForSending(inv.id)!;
    const again = finaliseForSending(inv.id)!;
    expect(again.share_token).toBe(first.share_token);
    expect(again.invoice_number).toBe(first.invoice_number);
    expect(again.status).toBe("sent");
  });

  test("it leaves a paid invoice alone but still publishes it", () => {
    const inv = newDraft();
    finaliseForSending(inv.id);
    getDb().run("UPDATE invoices SET status = 'paid' WHERE id = ?", [inv.id]);
    const after = finaliseForSending(inv.id)!;
    expect(after.status).toBe("paid");
    expect(after.is_published).toBe(1);
  });

  test("it returns null for a missing invoice", () => {
    expect(finaliseForSending("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/backend && bun test src/tests/invoice-send.test.ts
```

Expected: FAIL. `finaliseForSending` is not exported from `invoice.service.ts`.

- [ ] **Step 3: Implement finaliseForSending**

Add to `packages/backend/src/services/invoice.service.ts`, next to `publishInvoice` and `markSent`:

```ts
/**
 * Put an invoice into the state a delivery email needs: numbered, sent, and
 * publicly reachable.
 *
 * Order matters and is the whole point of this function. `publishInvoice`
 * refuses anything still in `draft`, so the status has to leave draft first,
 * and publishing is what mints the `share_token` the email links to. Calling
 * them the other way round (as the send route did) leaves a draft `sent` but
 * unpublished with no token, and the customer gets an email with no way to
 * view or pay the invoice.
 *
 * Idempotent: an already-sent, already-published invoice is returned unchanged.
 * Returns the re-read row, because both writes happen after the caller's copy
 * was loaded.
 */
export function finaliseForSending(id: string): InvoiceWithItems | null {
  const existing = getInvoice(id);
  if (!existing) return null;

  if (existing.status === "draft") markSent(id);
  if (!existing.is_published) publishInvoice(id);

  return getInvoice(id);
}
```

- [ ] **Step 4: Call it from the send route**

In `packages/backend/src/routes/invoices.ts`, replace the publish/mark block (currently lines 459-467):

```ts
  // Auto-publish if not published
  if (!invoice.is_published) {
    invoiceService.publishInvoice(invoice.id);
  }
  // Auto-mark as sent if draft
  if (invoice.status === "draft") {
    invoiceService.markSent(invoice.id);
  }
```

with:

```ts
  const finalised = invoiceService.finaliseForSending(invoice.id) ?? invoice;
```

Then point the email at the re-read invoice. `markSent` assigns the real
invoice number and `publishInvoice` mints the `share_token`, both after
`invoice` was loaded, so every field below must come from `finalised`:

```ts
  const publicUrl = finalised.share_token
    ? `${c.req.header("origin") || ""}/public/invoice/${finalised.share_token}`
    : null;

  const email = invoiceDeliveryEmail({
    company_name: settings.company_name || "Inkvoice",
    customer_name: finalised.customer?.name || "Customer",
    invoice_number: finalised.invoice_number,
    total: formatCurrency(finalised.total, finalised.currency),
    currency: finalised.currency,
    due_date: finalised.due_date,
    public_url: publicUrl,
    custom_message: body.message,
  });
```

Leave every other line of the handler alone, including the e-invoice
attachment block and the 400/502 error mapping.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd packages/backend && bun test src/tests/invoice-send.test.ts
```

Expected: 4 pass, 0 fail.

- [ ] **Step 6: Run the full backend suite for regressions**

```bash
cd packages/backend && bun test
```

Expected: no new failures. The invoice-number assertions in existing tests are the ones most likely to move; if any fail, it is because they asserted on a draft placeholder number that is now a real number, which is the correct new behaviour.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/invoice.service.ts packages/backend/src/routes/invoices.ts packages/backend/src/tests/invoice-send.test.ts
git commit -m "fix: give a freshly sent invoice its share link before emailing it"
```

---

### Task 2: Extract the send logic into a service

The scheduler needs to send invoices, and it has no HTTP request to read `origin` from.

**Files:**
- Create: `packages/backend/src/services/invoice-send.service.ts`
- Modify: `packages/backend/src/routes/invoices.ts:445`, `packages/backend/src/utils/env.ts`
- Test: `packages/backend/src/tests/invoice-send.test.ts`

**Interfaces:**
- Consumes: `isEmailConfigured()`, `sendEmail()` from `services/email.service.ts`; `invoiceDeliveryEmail()` from `services/email-templates.ts`; `emitEinvoice()` from `services/einvoice.service.ts`; `getAllSettings()` from `services/settings.service.ts`
- Produces:
  ```ts
  export interface SendInvoiceOptions {
    to?: string; subject?: string; message?: string;
    from?: string; replyTo?: string;
    attachEinvoice?: boolean; origin?: string;
  }
  export async function sendInvoiceEmail(
    invoiceId: string, opts?: SendInvoiceOptions,
  ): Promise<{ success: true } | { success: false; error: string; status: 400 | 404 | 502 }>;
  export function resolvePublicOrigin(requestOrigin?: string): string;
  ```

- [ ] **Step 1: Add the `PUBLIC_BASE_URL` env var**

In `packages/backend/src/utils/env.ts`, add `PUBLIC_BASE_URL: string;` to the `Env` interface and, in the object `getEnv()` builds, `PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || "",`. Follow the shape of the existing optional string vars. No validation and no boot-time failure: an empty value simply means no public link when there is no request origin.

- [ ] **Step 2: Write the failing test**

Append to `packages/backend/src/tests/invoice-send.test.ts`:

```ts
import { resolvePublicOrigin, sendInvoiceEmail } from "../services/invoice-send.service";

describe("resolvePublicOrigin", () => {
  test("prefers the request origin", () => {
    process.env.PUBLIC_BASE_URL = "https://env.example";
    resetEnvCache();
    expect(resolvePublicOrigin("https://req.example")).toBe("https://req.example");
  });

  test("falls back to PUBLIC_BASE_URL", () => {
    process.env.PUBLIC_BASE_URL = "https://env.example";
    resetEnvCache();
    expect(resolvePublicOrigin(undefined)).toBe("https://env.example");
  });

  test("returns empty string when neither is set", () => {
    process.env.PUBLIC_BASE_URL = "";
    resetEnvCache();
    expect(resolvePublicOrigin(undefined)).toBe("");
  });
});

describe("sendInvoiceEmail", () => {
  test("404s on a missing invoice", async () => {
    const result = await sendInvoiceEmail("nope");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.status).toBe(404);
  });

  test("400s when the customer has no email and none is supplied", async () => {
    const noEmailCustomer = crypto.randomBytes(16).toString("hex");
    getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [noEmailCustomer, "No Email Co"]);
    const inv = createInvoice({
      customer_id: noEmailCustomer, issue_date: "2026-09-04", currency: "USD",
      items: [{ description: "Work", quantity: 1, unit_price: 10 }],
    });
    const result = await sendInvoiceEmail(inv.id);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd packages/backend && bun test src/tests/invoice-send.test.ts
```

Expected: FAIL, `Cannot find module '../services/invoice-send.service'`.

- [ ] **Step 4: Create the service**

Create `packages/backend/src/services/invoice-send.service.ts`. Move the body of the route handler verbatim, changing only what the interface requires. Note the email-configured check comes first (matching the route's current 400), and the finalisation ordering from Task 1 is preserved.

```ts
import * as invoiceService from "./invoice.service";
import { isEmailConfigured, sendEmail } from "./email.service";
import { invoiceDeliveryEmail } from "./email-templates";
import { emitEinvoice } from "./einvoice.service";
import { getAllSettings } from "./settings.service";
import { formatCurrency } from "../utils/currency";
import { getEnv } from "../utils/env";
import { logger } from "../utils/logger";

export interface SendInvoiceOptions {
  to?: string;
  subject?: string;
  message?: string;
  from?: string;
  replyTo?: string;
  attachEinvoice?: boolean;
  /** Request origin when there is one. The scheduler has no request. */
  origin?: string;
}

export type SendInvoiceResult =
  | { success: true }
  | { success: false; error: string; status: 400 | 404 | 502 };

/**
 * Public origin for share links. A live request's origin wins; otherwise fall
 * back to PUBLIC_BASE_URL so scheduler-sent mail still carries a payment link.
 */
export function resolvePublicOrigin(requestOrigin?: string): string {
  if (requestOrigin) return requestOrigin;
  return getEnv().PUBLIC_BASE_URL || "";
}

export async function sendInvoiceEmail(
  invoiceId: string,
  opts: SendInvoiceOptions = {},
): Promise<SendInvoiceResult> {
  if (!(await isEmailConfigured())) {
    return { success: false, error: "Email is not configured", status: 400 };
  }

  const invoice = invoiceService.getInvoice(invoiceId);
  if (!invoice) return { success: false, error: "Invoice not found", status: 404 };

  const customerEmail = opts.to || invoice.customer?.email;
  if (!customerEmail) {
    return { success: false, error: "No recipient email address", status: 400 };
  }

  const finalised = invoiceService.finaliseForSending(invoice.id) ?? invoice;

  const settings = getAllSettings();
  const origin = resolvePublicOrigin(opts.origin);
  const publicUrl =
    finalised.share_token && origin ? `${origin}/public/invoice/${finalised.share_token}` : null;

  const email = invoiceDeliveryEmail({
    company_name: settings.company_name || "Inkvoice",
    customer_name: finalised.customer?.name || "Customer",
    invoice_number: finalised.invoice_number,
    total: formatCurrency(finalised.total, finalised.currency),
    currency: finalised.currency,
    due_date: finalised.due_date,
    public_url: publicUrl,
    custom_message: opts.message,
  });

  // E-invoice delivery: attach the ZUGFeRD hybrid PDF (or XRechnung XML) when
  // the workspace uses e-invoicing. Errors must not block the plain email.
  const attachments: Array<{
    filename: string;
    content: Buffer | Uint8Array;
    contentType: string;
  }> = [];
  const wantEinvoice = opts.attachEinvoice !== false && !!settings.einvoice_enabled;
  if (wantEinvoice) {
    try {
      const emitted = await emitEinvoice(finalised.id);
      if (emitted.pdf) {
        attachments.push({
          filename: `${finalised.invoice_number}-zugferd.pdf`,
          content: emitted.pdf,
          contentType: "application/pdf",
        });
      } else {
        attachments.push({
          filename: `${finalised.invoice_number}-${emitted.format}.xml`,
          content: Buffer.from(emitted.xml, "utf-8"),
          contentType: "application/xml",
        });
      }
    } catch (err: any) {
      logger.warn(`E-invoice emission failed for invoice ${finalised.id}: ${err.message}`);
    }
  }

  const result = await sendEmail({
    to: customerEmail,
    subject: opts.subject || email.subject,
    html: email.html,
    text: email.text,
    from: opts.from?.trim() || undefined,
    replyTo: opts.replyTo?.trim() || undefined,
    attachments,
  });

  if (!result.success) {
    const msg = result.error || "Email could not be delivered";
    const lower = msg.toLowerCase();
    const status =
      msg === "SMTP is not configured" ||
      lower.includes("recipient") ||
      lower.includes("address")
        ? 400
        : 502;
    return { success: false, error: msg, status };
  }

  return { success: true };
}
```

Check the exact import path and name of `formatCurrency` and `emitEinvoice` against the current imports at the top of `routes/invoices.ts` and match them.

- [ ] **Step 5: Rewrite the route as a thin wrapper**

Replace the whole body of `invoices.post("/:id/send", …)` in `routes/invoices.ts`:

```ts
invoices.post("/:id/send", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await sendInvoiceEmail(c.req.param("id"), {
    to: typeof body.to === "string" ? body.to : undefined,
    subject: typeof body.subject === "string" ? body.subject : undefined,
    message: typeof body.message === "string" ? body.message : undefined,
    from: typeof body.from === "string" ? body.from : undefined,
    replyTo: typeof body.reply_to === "string" ? body.reply_to : undefined,
    attachEinvoice: body.attach_einvoice !== false,
    origin: c.req.header("origin") || undefined,
  });

  if (!result.success) {
    return c.json({ success: false, error: result.error }, result.status);
  }
  return c.json({ success: true, data: { message: "Invoice sent" } });
});
```

Add `import { sendInvoiceEmail } from "../services/invoice-send.service";` and remove now-unused imports from `routes/invoices.ts` (Biome will flag them).

- [ ] **Step 6: Run tests and lint**

```bash
cd packages/backend && bun test && cd ../.. && bun run lint
```

Expected: all tests pass, lint clean.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/invoice-send.service.ts packages/backend/src/routes/invoices.ts packages/backend/src/utils/env.ts packages/backend/src/tests/invoice-send.test.ts
git commit -m "refactor: make invoice delivery callable outside a request"
```

---

### Task 3: Honour auto_send on recurring generation

**Files:**
- Modify: `packages/backend/src/database/migrations.ts`, `packages/backend/src/services/recurring.service.ts`, `packages/backend/src/routes/recurring.ts:63`, `packages/backend/src/services/scheduler.ts`
- Test: `packages/backend/src/tests/recurring-cron.test.ts`

**Interfaces:**
- Consumes: `sendInvoiceEmail` from Task 2
- Produces:
  ```ts
  export async function generateInvoice(recurringId: string): Promise<string | null>;
  export async function processAllDue(): Promise<{ generated: number; errors: number }>;
  ```
  `RecurringInvoice` gains `auto_bill: number`. `CreateRecurringData` gains `auto_bill?: boolean`.

- [ ] **Step 1: Add migration 27**

Append to the `MIGRATIONS` array in `packages/backend/src/database/migrations.ts`, after the `version: 26` entry:

```ts
  {
    version: 27,
    name: "recurring_auto_bill",
    up: (db) => {
      // Opt a recurring profile into charging the customer's saved card when
      // the profile fires. Default 0 keeps every existing profile on the
      // manual path.
      addColumnIfMissing(db, "recurring_invoices", "auto_bill", "INTEGER NOT NULL DEFAULT 0");
    },
  },
```

- [ ] **Step 2: Write the failing tests**

Add to `packages/backend/src/tests/recurring-cron.test.ts`. Note every existing `generateInvoice` / `processAllDue` call site in this file also needs `await` added in Step 4.

```ts
import { getInvoice } from "../services/invoice.service";

describe("finalisation on generation", () => {
  test("a default profile still generates a draft", async () => {
    const template = createInvoice({
      customer_id: customerId, issue_date: todayMinus(30), currency: "USD",
      items: [{ description: "Retainer", quantity: 1, unit_price: 500 }],
    });
    const rec = createRecurring({
      customer_id: customerId, template_invoice_id: template.id,
      frequency: "monthly", next_run_date: todayMinus(1),
    });

    const invoiceId = await generateInvoice(rec.id);
    expect(invoiceId).toBeTruthy();
    const generated = getInvoice(invoiceId!)!;
    expect(generated.status).toBe("draft");
    expect(generated.share_token).toBeNull();
  });

  test("an auto_send profile generates a finalised, share-linked invoice", async () => {
    const template = createInvoice({
      customer_id: customerId, issue_date: todayMinus(30), currency: "USD",
      items: [{ description: "Retainer", quantity: 1, unit_price: 500 }],
    });
    const rec = createRecurring({
      customer_id: customerId, template_invoice_id: template.id,
      frequency: "monthly", next_run_date: todayMinus(1), auto_send: true,
    });

    const invoiceId = await generateInvoice(rec.id);
    const generated = getInvoice(invoiceId!)!;
    expect(generated.status).toBe("sent");
    expect(generated.is_published).toBe(1);
    expect(generated.share_token).toBeTruthy();
  });

  test("an email failure still leaves the invoice generated", async () => {
    // Email is unconfigured in this suite, so sendInvoiceEmail returns
    // {success:false, status:400}. Generation must survive it.
    const template = createInvoice({
      customer_id: customerId, issue_date: todayMinus(30), currency: "USD",
      items: [{ description: "Retainer", quantity: 1, unit_price: 500 }],
    });
    const rec = createRecurring({
      customer_id: customerId, template_invoice_id: template.id,
      frequency: "monthly", next_run_date: todayMinus(1), auto_send: true,
    });

    const invoiceId = await generateInvoice(rec.id);
    expect(invoiceId).toBeTruthy();
    expect(getInvoice(invoiceId!)!.status).toBe("sent");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd packages/backend && bun test src/tests/recurring-cron.test.ts
```

Expected: the `auto_send` test FAILS with `expect(generated.status).toBe("sent")` receiving `"draft"`.

- [ ] **Step 4: Make generation async and finalise**

In `packages/backend/src/services/recurring.service.ts`:

Add `auto_bill: number;` to the `RecurringInvoice` interface and `auto_bill?: boolean;` to `CreateRecurringData`. Add `auto_bill` to the `INSERT` column list in `createRecurring` (value `data.auto_bill ? 1 : 0`) and to the `UPDATE` in `updateRecurring` (`auto_bill = COALESCE(?, auto_bill)`, value `data.auto_bill !== undefined ? (data.auto_bill ? 1 : 0) : null`), mirroring exactly how `auto_send` is handled in both.

Change the signature and add the finalise block. `generateInvoice` currently ends with `return newInvoice.id;` after the `db.run` that advances `next_run_date`. Replace that return with:

```ts
  // Finalise only when the merchant opted in. Profiles left at defaults keep
  // producing drafts, so nobody loses a review step they relied on.
  const shouldFinalise = recurring.auto_send === 1 || recurring.auto_bill === 1;
  if (!shouldFinalise) return newInvoice.id;

  finaliseForSending(newInvoice.id);

  if (recurring.auto_send === 1) {
    // Delivery failure must never roll back a generated invoice or stop the
    // scheduler. Generation and delivery are separate concerns.
    try {
      const sent = await sendInvoiceEmail(newInvoice.id, { attachEinvoice: true });
      if (!sent.success) {
        logger.warn(
          { recurringId, invoiceId: newInvoice.id, error: sent.error },
          "Recurring invoice generated but not emailed",
        );
      }
    } catch (err) {
      logger.error({ err, recurringId, invoiceId: newInvoice.id }, "Recurring send threw");
    }
  }

  return newInvoice.id;
```

Change the declaration to `export async function generateInvoice(recurringId: string): Promise<string | null> {` and add the imports:

```ts
import { finaliseForSending } from "./invoice.service";
import { sendInvoiceEmail } from "./invoice-send.service";
import { logger } from "../utils/logger";
```

(`createInvoice` and `getInvoice` are already imported from `./invoice.service`; extend that import rather than adding a second one.)

- [ ] **Step 5: Make processAllDue async**

Replace `processAllDue` in the same file:

```ts
export async function processAllDue(): Promise<{
  generated: number;
  errors: number;
}> {
  const db = getDb();
  const today = todayIso();
  const due = db
    .query("SELECT id FROM recurring_invoices WHERE status = 'active' AND next_run_date <= ?")
    .all(today) as { id: string }[];

  let generated = 0;
  let errors = 0;

  for (const row of due) {
    try {
      const invoiceId = await generateInvoice(row.id);
      if (invoiceId) generated++;
      else errors++;
    } catch {
      errors++;
    }
  }

  return { generated, errors };
}
```

- [ ] **Step 6: Update the two call sites**

`packages/backend/src/routes/recurring.ts:63` becomes:

```ts
  const invoiceId = await recurringService.generateInvoice(c.req.param("id"));
```

Confirm the enclosing handler is already `async`; if not, make it so. Also add `auto_bill: z.boolean().optional(),` to the zod schema alongside the existing `auto_send` at line 26.

`packages/backend/src/services/scheduler.ts` in `runScheduledTasks`:

```ts
    const recurring = await processAllDue();
```

- [ ] **Step 7: Add await at the existing test call sites**

In `packages/backend/src/tests/recurring-cron.test.ts`, every existing `generateInvoice(…)` and `processAllDue()` call now returns a promise. Add `await` to each and make the enclosing `test(…)` callbacks `async`. Search the file for both names to be sure none are missed.

- [ ] **Step 8: Run tests and typecheck**

```bash
cd packages/backend && bun test && cd ../.. && bun run typecheck
```

Expected: all tests pass. The typecheck catches any missed `await`.

- [ ] **Step 9: Commit**

```bash
git add packages/backend/src/database/migrations.ts packages/backend/src/services/recurring.service.ts packages/backend/src/routes/recurring.ts packages/backend/src/services/scheduler.ts packages/backend/src/tests/recurring-cron.test.ts
git commit -m "feat: send recurring invoices when the profile opts in"
```

---

## Phase 1, Capture a card

### Task 4: Schema for saved methods, attempts, and payment dedupe

**Files:**
- Modify: `packages/backend/src/database/migrations.ts`
- Test: `packages/backend/src/tests/migrations.test.ts` (create if absent)

**Interfaces:**
- Produces: tables `customer_payment_methods`, `auto_bill_attempts`; index `ux_payments_invoice_reference`. Column names are exactly as written here and are relied on by Tasks 6, 9, 10, 11.

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/tests/migrations.test.ts` (or append if it exists):

```ts
import { afterAll, beforeAll, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { closeDatabase, getDb, initDatabase } from "../database/connection";
import { LATEST_MIGRATION_VERSION, runMigrations } from "../database/migrations";
import { seed } from "../database/seed";
import { resetEnvCache } from "../utils/env";

const TEST_DB = "./data/test-migrations.db";

beforeAll(async () => {
  process.env.DATABASE_PATH = TEST_DB;
  process.env.ADMIN_USER = "admin";
  process.env.ADMIN_PASS = "migrationstestpass";
  process.env.JWT_SECRET = "test-secret-key-that-is-at-least-32-chars-long";
  resetEnvCache();
  initDatabase();
  runMigrations();
  await seed();
});

afterAll(() => {
  closeDatabase();
  for (const s of ["", "-wal", "-shm"]) {
    try { unlinkSync(TEST_DB + s); } catch {}
  }
});

function columns(table: string): string[] {
  return (getDb().query(`SELECT name FROM pragma_table_info(?)`).all(table) as { name: string }[])
    .map((r) => r.name);
}

test("migrations reach version 30", () => {
  expect(LATEST_MIGRATION_VERSION).toBe(30);
});

test("customer_payment_methods has the expected shape", () => {
  const cols = columns("customer_payment_methods");
  for (const c of [
    "id", "customer_id", "gateway", "gateway_customer_id", "gateway_method_id",
    "brand", "last4", "exp_month", "exp_year", "is_default",
    "consent_text", "consent_at", "created_at",
  ]) {
    expect(cols).toContain(c);
  }
});

test("auto_bill_attempts has the expected shape", () => {
  const cols = columns("auto_bill_attempts");
  for (const c of [
    "id", "invoice_id", "recurring_id", "payment_method_id", "attempt_no",
    "status", "gateway_reference", "error_code", "error_message",
    "next_retry_at", "created_at",
  ]) {
    expect(cols).toContain(c);
  }
});

test("payments dedupe index exists", () => {
  const idx = getDb()
    .query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get("ux_payments_invoice_reference");
  expect(idx).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/backend && bun test src/tests/migrations.test.ts
```

Expected: FAIL, `LATEST_MIGRATION_VERSION` is 27 after Task 3, and the tables do not exist.

- [ ] **Step 3: Add migrations 28, 29, 30**

Append to `MIGRATIONS` in `packages/backend/src/database/migrations.ts`:

```ts
  {
    version: 28,
    name: "customer_payment_methods",
    up: (db) => {
      // Saved cards for off-session billing. Stripe tokens and display
      // metadata only: no PAN, no CVV, nothing that could reconstruct a card.
      // consent_text stores the mandate copy shown at capture, verbatim, so a
      // disputed charge can be answered with what the customer actually agreed to.
      db.exec(`
        CREATE TABLE IF NOT EXISTS customer_payment_methods (
          id                  TEXT PRIMARY KEY,
          customer_id         TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          gateway             TEXT NOT NULL DEFAULT 'stripe',
          gateway_customer_id TEXT NOT NULL,
          gateway_method_id   TEXT NOT NULL,
          brand               TEXT,
          last4               TEXT,
          exp_month           INTEGER,
          exp_year            INTEGER,
          is_default          INTEGER NOT NULL DEFAULT 0,
          consent_text        TEXT,
          consent_at          TEXT,
          created_at          TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_cpm_gateway_method
          ON customer_payment_methods(gateway, gateway_method_id)
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_cpm_customer
          ON customer_payment_methods(customer_id)
      `);
    },
  },
  {
    version: 29,
    name: "auto_bill_attempts",
    up: (db) => {
      // Dunning log and audit trail. One row per charge attempt, terminal when
      // next_retry_at is NULL. The unique index on (invoice_id, attempt_no) is
      // half the double-charge guard; the Stripe idempotency key is the other half.
      db.exec(`
        CREATE TABLE IF NOT EXISTS auto_bill_attempts (
          id                TEXT PRIMARY KEY,
          invoice_id        TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
          recurring_id      TEXT,
          payment_method_id TEXT,
          attempt_no        INTEGER NOT NULL,
          status            TEXT NOT NULL,
          gateway_reference TEXT,
          error_code        TEXT,
          error_message     TEXT,
          next_retry_at     TEXT,
          created_at        TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_aba_invoice_attempt
          ON auto_bill_attempts(invoice_id, attempt_no)
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_aba_retry
          ON auto_bill_attempts(next_retry_at) WHERE next_retry_at IS NOT NULL
      `);
    },
  },
  {
    version: 30,
    name: "payments_reference_dedupe",
    up: (db) => {
      // Promoted from the cloud overlay (tenant-migrations.ts) so both
      // deployments share one idempotency guarantee. An existing self-hosted
      // database may already hold duplicate (invoice_id, reference) pairs from
      // a retried webhook, so deduplicate before the unique index goes on.
      const removed = db.run(`
        DELETE FROM payments
        WHERE reference IS NOT NULL
          AND rowid NOT IN (
            SELECT MIN(rowid) FROM payments
            WHERE reference IS NOT NULL
            GROUP BY invoice_id, reference
          )
      `);
      if (removed.changes > 0) {
        logger.warn(
          { removed: removed.changes },
          "Removed duplicate payment rows before adding the reference index",
        );
      }
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_invoice_reference
          ON payments(invoice_id, reference) WHERE reference IS NOT NULL
      `);
    },
  },
```

`logger` is already imported at the top of `migrations.ts`; confirm before using it.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/backend && bun test src/tests/migrations.test.ts
```

Expected: 4 pass.

- [ ] **Step 5: Verify the dedupe branch against dirty data**

Migration 30 is the only one that can destroy rows, so prove it on a database that actually has duplicates rather than trusting the SQL. In a scratch script or a temporary test, create a database at migration 29, insert two payments sharing `(invoice_id, reference)`, then run migration 30 and assert exactly one row survives and it is the older one.

```bash
cd packages/backend && bun test src/tests/migrations.test.ts
```

Expected: PASS, and the run logs "Removed duplicate payment rows before adding the reference index" with `removed: 1`.

- [ ] **Step 6: Run the full suite and commit**

```bash
cd packages/backend && bun test
git add packages/backend/src/database/migrations.ts packages/backend/src/tests/migrations.test.ts
git commit -m "feat: schema for saved payment methods and billing attempts"
```

---

### Task 5: Stripe client resolver hook

**Files:**
- Modify: `packages/backend/src/services/stripe.service.ts`
- Test: `packages/backend/src/tests/auto-bill.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  export type StripeClientResolver = () => Promise<Stripe | null>;
  export function setStripeClientResolver(r: StripeClientResolver | null): void;
  export type StripeConfiguredChecker = () => boolean;
  export function setStripeConfiguredChecker(c: StripeConfiguredChecker | null): void;
  ```
  Task 13 registers both from the cloud overlay. Tasks 6 and 8 rely on `getStripe()` honouring the resolver.

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/tests/auto-bill.test.ts` with the standard bootstrap (copy the `beforeAll`/`afterAll` block from `recurring-cron.test.ts`, using `TEST_DB = "./data/test-auto-bill.db"` and `ADMIN_PASS = "autobilltestpass"`), then:

```ts
import { isStripeConfigured, setStripeClientResolver, setStripeConfiguredChecker } from "../services/stripe.service";

describe("stripe client resolution", () => {
  afterEach(() => {
    setStripeClientResolver(null);
    setStripeConfiguredChecker(null);
  });

  test("isStripeConfigured defers to a registered checker", () => {
    setStripeConfiguredChecker(() => true);
    expect(isStripeConfigured()).toBe(true);
    setStripeConfiguredChecker(() => false);
    expect(isStripeConfigured()).toBe(false);
  });

  test("without a checker it falls back to env", () => {
    // Neither STRIPE_SECRET_KEY nor STRIPE_WEBHOOK_SECRET is set in this suite.
    expect(isStripeConfigured()).toBe(false);
  });
});
```

Import `afterEach` from `bun:test`.

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/backend && bun test src/tests/auto-bill.test.ts
```

Expected: FAIL, `setStripeConfiguredChecker` is not exported.

- [ ] **Step 3: Add the hooks**

In `packages/backend/src/services/stripe.service.ts`, after the existing `stripeClientPromise` declaration:

```ts
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
```

Change `isStripeConfigured` to consult the checker first:

```ts
export function isStripeConfigured(): boolean {
  if (configuredChecker) return configuredChecker();
  const env = getEnv();
  return !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}
```

Change `getStripe` to consult the resolver. It must not cache a resolver result, because the correct client varies per tenant per request:

```ts
function getStripe(): Promise<Stripe> {
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
```

Export `getStripe` so Tasks 6 and 8 can use it: change `function getStripe` to `export function getStripe`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/backend && bun test src/tests/auto-bill.test.ts
```

Expected: 2 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/stripe.service.ts packages/backend/src/tests/auto-bill.test.ts
git commit -m "feat: let a deployment supply its own Stripe client"
```

---

### Task 6: Saved payment method service

**Files:**
- Create: `packages/backend/src/services/customer-payment-method.service.ts`
- Test: `packages/backend/src/tests/auto-bill.test.ts`

**Interfaces:**
- Consumes: `getStripe` from Task 5, `customer_payment_methods` from Task 4
- Produces:
  ```ts
  export interface CustomerPaymentMethod {
    id: string; customer_id: string; gateway: string;
    gateway_customer_id: string; gateway_method_id: string;
    brand: string | null; last4: string | null;
    exp_month: number | null; exp_year: number | null;
    is_default: number; consent_text: string | null;
    consent_at: string | null; created_at: string;
  }
  export function listMethodsForCustomer(customerId: string): CustomerPaymentMethod[];
  export function getDefaultMethod(customerId: string): CustomerPaymentMethod | null;
  export function saveMethod(input: {
    customerId: string; gateway?: string;
    gatewayCustomerId: string; gatewayMethodId: string;
    brand?: string | null; last4?: string | null;
    expMonth?: number | null; expYear?: number | null;
    consentText?: string | null;
  }): CustomerPaymentMethod;
  export async function deleteMethod(
    id: string, customerId: string,
  ): Promise<{ success: true } | { success: false; error: string }>;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `packages/backend/src/tests/auto-bill.test.ts`:

```ts
import {
  getDefaultMethod, listMethodsForCustomer, saveMethod,
} from "../services/customer-payment-method.service";

describe("customer payment methods", () => {
  test("the first saved method becomes the default", () => {
    const m = saveMethod({
      customerId, gatewayCustomerId: "cus_1", gatewayMethodId: "pm_1",
      brand: "visa", last4: "4242", expMonth: 12, expYear: 2030,
      consentText: "You authorise Acme to charge this card for future invoices.",
    });
    expect(m.is_default).toBe(1);
    expect(getDefaultMethod(customerId)?.gateway_method_id).toBe("pm_1");
  });

  test("a second saved method does not steal the default", () => {
    saveMethod({ customerId, gatewayCustomerId: "cus_1", gatewayMethodId: "pm_2", last4: "1111" });
    expect(getDefaultMethod(customerId)?.gateway_method_id).toBe("pm_1");
    expect(listMethodsForCustomer(customerId)).toHaveLength(2);
  });

  test("re-saving the same gateway method is idempotent", () => {
    const before = listMethodsForCustomer(customerId).length;
    saveMethod({ customerId, gatewayCustomerId: "cus_1", gatewayMethodId: "pm_1", last4: "4242" });
    expect(listMethodsForCustomer(customerId)).toHaveLength(before);
  });

  test("consent text is stored verbatim with a timestamp", () => {
    const stored = listMethodsForCustomer(customerId).find((m) => m.gateway_method_id === "pm_1")!;
    expect(stored.consent_text).toBe(
      "You authorise Acme to charge this card for future invoices.",
    );
    expect(stored.consent_at).toBeTruthy();
  });

  test("a customer with no methods has no default", () => {
    const other = crypto.randomBytes(16).toString("hex");
    getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [other, "No Cards Co"]);
    expect(getDefaultMethod(other)).toBeNull();
    expect(listMethodsForCustomer(other)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/backend && bun test src/tests/auto-bill.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Create the service**

Create `packages/backend/src/services/customer-payment-method.service.ts`:

```ts
import crypto from "node:crypto";
import { getDb } from "../database/connection";
import { logger } from "../utils/logger";
import { getStripe } from "./stripe.service";

export interface CustomerPaymentMethod {
  id: string;
  customer_id: string;
  gateway: string;
  gateway_customer_id: string;
  gateway_method_id: string;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  is_default: number;
  consent_text: string | null;
  consent_at: string | null;
  created_at: string;
}

export function listMethodsForCustomer(customerId: string): CustomerPaymentMethod[] {
  return getDb()
    .query(
      `SELECT * FROM customer_payment_methods
       WHERE customer_id = ? ORDER BY is_default DESC, created_at ASC`,
    )
    .all(customerId) as CustomerPaymentMethod[];
}

export function getDefaultMethod(customerId: string): CustomerPaymentMethod | null {
  return getDb()
    .query(
      `SELECT * FROM customer_payment_methods
       WHERE customer_id = ? AND is_default = 1 LIMIT 1`,
    )
    .get(customerId) as CustomerPaymentMethod | null;
}

export function getMethodById(id: string): CustomerPaymentMethod | null {
  return getDb()
    .query("SELECT * FROM customer_payment_methods WHERE id = ?")
    .get(id) as CustomerPaymentMethod | null;
}

/**
 * Persist a tokenised method. Idempotent on (gateway, gateway_method_id): a
 * replayed webhook updates the display metadata instead of adding a row. The
 * first method a customer saves becomes their default; later ones do not
 * silently take over the card that recurring profiles are already billing.
 */
export function saveMethod(input: {
  customerId: string;
  gateway?: string;
  gatewayCustomerId: string;
  gatewayMethodId: string;
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
  consentText?: string | null;
}): CustomerPaymentMethod {
  const db = getDb();
  const gateway = input.gateway ?? "stripe";

  const existing = db
    .query("SELECT * FROM customer_payment_methods WHERE gateway = ? AND gateway_method_id = ?")
    .get(gateway, input.gatewayMethodId) as CustomerPaymentMethod | null;

  if (existing) {
    db.run(
      `UPDATE customer_payment_methods
       SET brand = COALESCE(?, brand), last4 = COALESCE(?, last4),
           exp_month = COALESCE(?, exp_month), exp_year = COALESCE(?, exp_year)
       WHERE id = ?`,
      [
        input.brand ?? null,
        input.last4 ?? null,
        input.expMonth ?? null,
        input.expYear ?? null,
        existing.id,
      ],
    );
    return getMethodById(existing.id)!;
  }

  const hasDefault = !!getDefaultMethod(input.customerId);
  const id = crypto.randomBytes(16).toString("hex");

  db.run(
    `INSERT INTO customer_payment_methods
       (id, customer_id, gateway, gateway_customer_id, gateway_method_id,
        brand, last4, exp_month, exp_year, is_default, consent_text, consent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.customerId,
      gateway,
      input.gatewayCustomerId,
      input.gatewayMethodId,
      input.brand ?? null,
      input.last4 ?? null,
      input.expMonth ?? null,
      input.expYear ?? null,
      hasDefault ? 0 : 1,
      input.consentText ?? null,
      input.consentText ? new Date().toISOString() : null,
    ],
  );

  return getMethodById(id)!;
}

/**
 * Revoke a method. Detaching at the gateway comes first: if that fails we keep
 * the row, so local state never claims a card is gone while Stripe still holds
 * it and could still be charged.
 */
export async function deleteMethod(
  id: string,
  customerId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const method = getMethodById(id);
  if (!method || method.customer_id !== customerId) {
    return { success: false, error: "Payment method not found" };
  }

  if (method.gateway === "stripe") {
    try {
      const stripe = await getStripe();
      await stripe.paymentMethods.detach(method.gateway_method_id);
    } catch (err: any) {
      // A method Stripe has already lost is fine to drop locally; anything else
      // must keep the row so the customer is not told it is revoked when it is not.
      const code = err?.code ?? err?.raw?.code;
      if (code !== "resource_missing") {
        logger.error({ err, methodId: id }, "Stripe detach failed, keeping local method");
        return { success: false, error: "Could not revoke the card at the payment provider" };
      }
    }
  }

  const db = getDb();
  const wasDefault = method.is_default === 1;
  db.run("DELETE FROM customer_payment_methods WHERE id = ?", [id]);

  if (wasDefault) {
    const next = db
      .query(
        `SELECT id FROM customer_payment_methods
         WHERE customer_id = ? ORDER BY created_at ASC LIMIT 1`,
      )
      .get(customerId) as { id: string } | null;
    if (next) {
      db.run("UPDATE customer_payment_methods SET is_default = 1 WHERE id = ?", [next.id]);
    }
  }

  return { success: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/backend && bun test src/tests/auto-bill.test.ts
```

Expected: 7 pass (2 from Task 5, 5 here).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/customer-payment-method.service.ts packages/backend/src/tests/auto-bill.test.ts
git commit -m "feat: store and revoke tokenised customer payment methods"
```

---

### Task 7: Capture the card at checkout

**Files:**
- Modify: `packages/backend/src/services/stripe.service.ts`, `packages/backend/src/services/payment-gateways/types.ts`, `packages/backend/src/services/payment-gateways/stripe.gateway.ts`, `packages/backend/src/routes/public.ts:95-128`, `packages/frontend/src/pages/PublicInvoice.tsx`, `packages/frontend/src/i18n/{en,tr,de,es,fr}.ts`
- Test: `packages/backend/src/tests/auto-bill.test.ts`

**Interfaces:**
- Consumes: `saveMethod` from Task 6
- Produces:
  ```ts
  // types.ts
  export interface CheckoutContext { /* existing fields */ save_card?: boolean; customerId?: string | null; consentText?: string | null; }
  // stripe.service.ts
  export async function saveMethodFromCheckoutSession(session: Stripe.Checkout.Session): Promise<void>;
  ```
  Task 13 calls `saveMethodFromCheckoutSession` from the cloud webhook.

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/src/tests/auto-bill.test.ts`. The Stripe SDK is the only thing mocked, following `stripe-byo.test.ts`:

```ts
import { saveMethodFromCheckoutSession } from "../services/stripe.service";

describe("card capture from checkout", () => {
  afterEach(() => setStripeClientResolver(null));

  function mockStripe(overrides: Record<string, any> = {}) {
    setStripeClientResolver(async () => ({
      paymentIntents: {
        retrieve: async () => ({
          id: "pi_capture", payment_method: "pm_captured", customer: "cus_captured",
        }),
      },
      paymentMethods: {
        retrieve: async () => ({
          id: "pm_captured",
          card: { brand: "mastercard", last4: "5555", exp_month: 4, exp_year: 2031 },
        }),
        detach: async () => ({}),
      },
      ...overrides,
    }) as any);
  }

  test("a session without save_card saves nothing", async () => {
    mockStripe();
    const before = listMethodsForCustomer(customerId).length;
    await saveMethodFromCheckoutSession({
      payment_status: "paid",
      payment_intent: "pi_capture",
      metadata: { invoice_id: "inv_1", customer_id: customerId },
    } as any);
    expect(listMethodsForCustomer(customerId)).toHaveLength(before);
  });

  test("a session with save_card persists the method", async () => {
    mockStripe();
    await saveMethodFromCheckoutSession({
      payment_status: "paid",
      payment_intent: "pi_capture",
      metadata: {
        invoice_id: "inv_1", customer_id: customerId,
        save_card: "1", consent_text: "You authorise Acme to charge this card.",
      },
    } as any);
    const saved = listMethodsForCustomer(customerId).find(
      (m) => m.gateway_method_id === "pm_captured",
    );
    expect(saved).toBeTruthy();
    expect(saved!.brand).toBe("mastercard");
    expect(saved!.last4).toBe("5555");
    expect(saved!.gateway_customer_id).toBe("cus_captured");
    expect(saved!.consent_text).toBe("You authorise Acme to charge this card.");
  });

  test("an unpaid session saves nothing", async () => {
    mockStripe();
    const before = listMethodsForCustomer(customerId).length;
    await saveMethodFromCheckoutSession({
      payment_status: "unpaid",
      payment_intent: "pi_capture",
      metadata: { invoice_id: "inv_1", customer_id: customerId, save_card: "1" },
    } as any);
    expect(listMethodsForCustomer(customerId)).toHaveLength(before);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/backend && bun test src/tests/auto-bill.test.ts
```

Expected: FAIL, `saveMethodFromCheckoutSession` is not exported.

- [ ] **Step 3: Extend the checkout context and session creation**

In `packages/backend/src/services/payment-gateways/types.ts`, add to `CheckoutContext`:

```ts
  /** Payer opted in to saving this card for future invoices. */
  save_card?: boolean;
  /** Inkvoice customer id, needed to attach a saved method on the way back. */
  customerId?: string | null;
  /** Mandate copy shown at capture, stored verbatim with the saved method. */
  consentText?: string | null;
```

In `packages/backend/src/services/stripe.service.ts`, extend `createCheckoutSession`'s options with the same three fields and add, inside the `stripe.checkout.sessions.create({…})` call:

```ts
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
```

replacing the existing `metadata` property. Stripe caps a metadata value at 500 characters, hence the slice.

- [ ] **Step 4: Add the persistence function**

Append to `packages/backend/src/services/stripe.service.ts`:

```ts
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
      typeof intent.payment_method === "string"
        ? intent.payment_method
        : intent.payment_method?.id;
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
```

Add `import { logger } from "../utils/logger";` at the top if absent.

- [ ] **Step 5: Wire the gateway and the route**

In `payment-gateways/stripe.gateway.ts`, pass the new fields through `createCheckout` and call the saver in `handleWebhook`:

```ts
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
```

Import `saveMethodFromCheckoutSession` and `type Stripe` accordingly.

In `packages/backend/src/routes/public.ts`, the `POST /invoices/:shareToken/pay` handler reads `save_card` from the body and passes it plus the invoice's customer id and the rendered mandate copy:

```ts
  const body = (await c.req.json().catch(() => ({}))) as {
    gateway?: string;
    save_card?: boolean;
    consent_text?: string;
  };
```

and in the `gateway.createCheckout({…})` call add:

```ts
      save_card: body.save_card === true,
      customerId: invoice.customer_id ?? null,
      consentText: body.save_card === true ? (body.consent_text ?? "").slice(0, 480) : null,
```

The consent text arrives from the client because it is the localised string the payer actually saw. It is stored as a record, never trusted for any decision.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd packages/backend && bun test src/tests/auto-bill.test.ts
```

Expected: 10 pass.

- [ ] **Step 7: Add the frontend opt-in and i18n keys**

Add to the `public` namespace in `packages/frontend/src/i18n/en.ts`:

```ts
    save_card: "Save this card for future invoices",
    save_card_consent:
      "You authorise {{company}} to charge this card for future invoices. You can remove it at any time from your customer portal.",
```

Add the same two keys to `tr.ts`, `de.ts`, `es.ts`, `fr.ts`, translated. Follow the existing placeholder convention in each file (check how another key with a `{…}` placeholder is written before adding these).

In `packages/frontend/src/pages/PublicInvoice.tsx`, add a checkbox above the pay button, shown only when the selected gateway is `stripe`. Wire its state into the `POST /invoices/:shareToken/pay` request body as `save_card`, and send the rendered `save_card_consent` string (with `{{company}}` interpolated) as `consent_text`. Follow the component's existing pattern for reading `t(…)` and posting to the pay endpoint.

- [ ] **Step 8: Verify in the browser**

```bash
cd /Users/baris/projects/inhouse/inkvoice-mono/inkvoice && bun run dev
```

Open a published invoice's public page. Confirm the checkbox renders with the mandate copy, that it appears only for Stripe, and that ticking it sends `save_card: true` in the pay request (check the network panel). Take a screenshot of the checkbox in place.

- [ ] **Step 9: Commit**

```bash
git add packages/backend/src/services/stripe.service.ts packages/backend/src/services/payment-gateways/ packages/backend/src/routes/public.ts packages/frontend/src/pages/PublicInvoice.tsx packages/frontend/src/i18n/ packages/backend/src/tests/auto-bill.test.ts
git commit -m "feat: let a payer save their card during checkout"
```

---

## Phase 2, Charge off-session

### Task 8: Off-session charge on the gateway

**Files:**
- Modify: `packages/backend/src/services/payment-gateways/types.ts`, `packages/backend/src/services/payment-gateways/stripe.gateway.ts`, `packages/backend/src/services/payment-gateways/registry.ts`, `packages/backend/src/services/stripe.service.ts`
- Test: `packages/backend/src/tests/auto-bill.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface OffSessionContext {
    invoiceId: string; amount: number; currency: string;
    gatewayCustomerId: string; gatewayMethodId: string; attemptNo: number;
  }
  export type OffSessionStatus = "succeeded" | "requires_action" | "soft_failed" | "hard_failed";
  export interface OffSessionResult {
    status: OffSessionStatus; reference?: string;
    errorCode?: string; errorMessage?: string;
  }
  // PaymentGateway gains:
  readonly supportsAutoBill?: boolean;
  chargeOffSession?(ctx: OffSessionContext): Promise<OffSessionResult>;
  // registry.ts
  export function getAutoBillGateways(): PaymentGateway[];
  // stripe.service.ts
  export function classifyStripeError(code: string | undefined): OffSessionStatus;
  export async function chargeOffSession(ctx: OffSessionContext): Promise<OffSessionResult>;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `packages/backend/src/tests/auto-bill.test.ts`:

```ts
import { chargeOffSession, classifyStripeError } from "../services/stripe.service";

describe("stripe error classification", () => {
  test("SCA is terminal, never retried", () => {
    expect(classifyStripeError("authentication_required")).toBe("requires_action");
  });

  test("hard declines are terminal", () => {
    for (const code of [
      "card_declined", "expired_card", "incorrect_number",
      "invalid_account", "card_velocity_exceeded",
    ]) {
      expect(classifyStripeError(code)).toBe("hard_failed");
    }
  });

  test("soft declines are retryable", () => {
    for (const code of [
      "insufficient_funds", "processing_error", "issuer_not_available", "try_again_later",
    ]) {
      expect(classifyStripeError(code)).toBe("soft_failed");
    }
  });

  test("an unrecognised code is treated as retryable", () => {
    expect(classifyStripeError("some_new_stripe_code")).toBe("soft_failed");
    expect(classifyStripeError(undefined)).toBe("soft_failed");
  });
});

describe("chargeOffSession", () => {
  afterEach(() => setStripeClientResolver(null));

  test("a succeeded intent returns its reference", async () => {
    const calls: any[] = [];
    setStripeClientResolver(async () => ({
      paymentIntents: {
        create: async (params: any, opts: any) => {
          calls.push({ params, opts });
          return { id: "pi_ok", status: "succeeded" };
        },
      },
    }) as any);

    const result = await chargeOffSession({
      invoiceId: "inv_ok", amount: 125.5, currency: "USD",
      gatewayCustomerId: "cus_1", gatewayMethodId: "pm_1", attemptNo: 1,
    });

    expect(result.status).toBe("succeeded");
    expect(result.reference).toBe("pi_ok");
    // Amount converted to minor units, off-session confirmed, idempotency keyed.
    expect(calls[0].params.amount).toBe(12550);
    expect(calls[0].params.currency).toBe("usd");
    expect(calls[0].params.off_session).toBe(true);
    expect(calls[0].params.confirm).toBe(true);
    expect(calls[0].opts.idempotencyKey).toBe("autobill:inv_ok:1");
  });

  test("a card error is classified rather than thrown", async () => {
    setStripeClientResolver(async () => ({
      paymentIntents: {
        create: async () => {
          const err: any = new Error("Your card has insufficient funds.");
          err.type = "StripeCardError";
          err.code = "insufficient_funds";
          throw err;
        },
      },
    }) as any);

    const result = await chargeOffSession({
      invoiceId: "inv_soft", amount: 10, currency: "USD",
      gatewayCustomerId: "cus_1", gatewayMethodId: "pm_1", attemptNo: 1,
    });

    expect(result.status).toBe("soft_failed");
    expect(result.errorCode).toBe("insufficient_funds");
  });

  test("SCA surfaces as requires_action", async () => {
    setStripeClientResolver(async () => ({
      paymentIntents: {
        create: async () => {
          const err: any = new Error("Authentication required");
          err.type = "StripeCardError";
          err.code = "authentication_required";
          throw err;
        },
      },
    }) as any);

    const result = await chargeOffSession({
      invoiceId: "inv_sca", amount: 10, currency: "USD",
      gatewayCustomerId: "cus_1", gatewayMethodId: "pm_1", attemptNo: 1,
    });

    expect(result.status).toBe("requires_action");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/backend && bun test src/tests/auto-bill.test.ts
```

Expected: FAIL, `chargeOffSession` not exported.

- [ ] **Step 3: Add the types**

Append to `packages/backend/src/services/payment-gateways/types.ts`:

```ts
/** Everything a gateway needs to charge a stored method with nobody present. */
export interface OffSessionContext {
  invoiceId: string;
  /** Outstanding balance, in the invoice currency. Always server-derived. */
  amount: number;
  currency: string;
  gatewayCustomerId: string;
  gatewayMethodId: string;
  /** 1-based. Forms the idempotency key, so a retry is a distinct charge. */
  attemptNo: number;
}

export type OffSessionStatus =
  | "succeeded"
  /** Needs the customer present (SCA). Retrying off-session can never work. */
  | "requires_action"
  /** Transient. Worth retrying on a schedule. */
  | "soft_failed"
  /** Permanent for this card. Retrying only burns retries. */
  | "hard_failed";

export interface OffSessionResult {
  status: OffSessionStatus;
  reference?: string;
  errorCode?: string;
  errorMessage?: string;
}
```

and to the `PaymentGateway` interface:

```ts
  /** True when this gateway can charge a stored method with nobody present. */
  readonly supportsAutoBill?: boolean;
  /** Charge a stored method. Only defined when supportsAutoBill is true. */
  chargeOffSession?(ctx: OffSessionContext): Promise<OffSessionResult>;
```

- [ ] **Step 4: Implement classification and the charge**

Append to `packages/backend/src/services/stripe.service.ts`:

```ts
// Codes that will never succeed on a retry: the card or account is wrong, not
// momentarily unable to pay. Retrying these only burns the attempt budget and
// can look like card testing to the issuer.
const HARD_DECLINE_CODES = new Set([
  "card_declined",
  "expired_card",
  "incorrect_number",
  "incorrect_cvc",
  "invalid_account",
  "invalid_card_type",
  "card_velocity_exceeded",
  "pickup_card",
  "lost_card",
  "stolen_card",
  "do_not_honor",
]);

/**
 * Map a Stripe error code onto a retry decision. Unrecognised codes are treated
 * as retryable: Stripe adds codes over time, and a transient failure wrongly
 * classified as permanent silently costs the merchant money.
 */
export function classifyStripeError(code: string | undefined): OffSessionStatus {
  if (code === "authentication_required") return "requires_action";
  if (code && HARD_DECLINE_CODES.has(code)) return "hard_failed";
  return "soft_failed";
}

export async function chargeOffSession(ctx: OffSessionContext): Promise<OffSessionResult> {
  try {
    // getStripe() must be INSIDE the try. Under the cloud resolver it throws
    // when a tenant's key cannot be produced (rotation, decrypt failure), and
    // this function's contract is that a failure is a return value, not a throw.
    const stripe = await getStripe();
    const intent = await stripe.paymentIntents.create(
      {
        amount: Math.round(ctx.amount * 100),
        currency: ctx.currency.toLowerCase(),
        customer: ctx.gatewayCustomerId,
        payment_method: ctx.gatewayMethodId,
        off_session: true,
        confirm: true,
        metadata: { invoice_id: ctx.invoiceId, auto_bill: "1" },
      },
      // Keyed per attempt, so a duplicated scheduler tick replays the same
      // charge instead of creating a second one, while a genuine retry is new.
      { idempotencyKey: `autobill:${ctx.invoiceId}:${ctx.attemptNo}` },
    );

    if (intent.status === "succeeded") {
      return { status: "succeeded", reference: intent.id };
    }
    if (intent.status === "requires_action") {
      return { status: "requires_action", reference: intent.id, errorCode: "requires_action" };
    }
    return {
      status: "soft_failed",
      reference: intent.id,
      errorCode: intent.status,
      errorMessage: `PaymentIntent settled as ${intent.status}`,
    };
  } catch (err: any) {
    const code: string | undefined = err?.code ?? err?.raw?.code;
    return {
      status: classifyStripeError(code),
      reference: err?.raw?.payment_intent?.id,
      errorCode: code,
      errorMessage: typeof err?.message === "string" ? err.message.slice(0, 500) : undefined,
    };
  }
}
```

Import the new types at the top of the file.

- [ ] **Step 5: Declare the capability on the gateway and registry**

In `payment-gateways/stripe.gateway.ts` add `supportsAutoBill: true,` to the object and:

```ts
  chargeOffSession(ctx: OffSessionContext): Promise<OffSessionResult> {
    return chargeOffSession(ctx);
  },
```

importing `chargeOffSession` from `../stripe.service` (alias the import to avoid shadowing, e.g. `chargeOffSession as stripeChargeOffSession`).

In `payment-gateways/registry.ts`:

```ts
/** Enabled gateways that can charge a stored method with nobody present. */
export function getAutoBillGateways(): PaymentGateway[] {
  return getEnabledGateways().filter((g) => g.supportsAutoBill === true);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd packages/backend && bun test src/tests/auto-bill.test.ts
```

Expected: 17 pass.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/payment-gateways/ packages/backend/src/services/stripe.service.ts packages/backend/src/tests/auto-bill.test.ts
git commit -m "feat: charge a stored card off-session through the gateway"
```

---

### Task 9: The auto-bill engine

**Files:**
- Create: `packages/backend/src/services/auto-bill.service.ts`
- Modify: `packages/backend/src/routes/settings.ts:117`
- Test: `packages/backend/src/tests/auto-bill.test.ts`

**Interfaces:**
- Consumes: `chargeOffSession` (Task 8), `getDefaultMethod` (Task 6), `recordPayment` from `payment.service.ts`, `sendInvoiceEmail` (Task 2)
- Produces:
  ```ts
  export const RETRY_OFFSET_DAYS: readonly number[]; // [1, 3, 5]
  export const MAX_ATTEMPTS: number;                 // 3
  export async function attemptAutoBill(
    invoiceId: string, opts?: { recurringId?: string; attemptNo?: number },
  ): Promise<OffSessionResult | { status: "skipped"; errorCode: string }>;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `packages/backend/src/tests/auto-bill.test.ts`:

```ts
import { attemptAutoBill } from "../services/auto-bill.service";
import { finaliseForSending, getInvoice } from "../services/invoice.service";

function attemptsFor(invoiceId: string) {
  return getDb()
    .query("SELECT * FROM auto_bill_attempts WHERE invoice_id = ? ORDER BY attempt_no ASC")
    .all(invoiceId) as any[];
}

function sentInvoiceFor(customer: string, amount: number) {
  const inv = createInvoice({
    customer_id: customer, issue_date: "2026-09-04", currency: "USD",
    items: [{ description: "Work", quantity: 1, unit_price: amount }],
  });
  finaliseForSending(inv.id);
  return getInvoice(inv.id)!;
}

describe("attemptAutoBill", () => {
  afterEach(() => setStripeClientResolver(null));

  test("skips a customer with no saved method", async () => {
    const bare = crypto.randomBytes(16).toString("hex");
    getDb().run("INSERT INTO customers (id, name) VALUES (?, ?)", [bare, "Bare Co"]);
    const inv = sentInvoiceFor(bare, 50);

    const result = await attemptAutoBill(inv.id);
    expect(result.status).toBe("skipped");
    expect(attemptsFor(inv.id)).toHaveLength(0);
  });

  test("a successful charge records a payment and pays the invoice", async () => {
    setStripeClientResolver(async () => ({
      paymentIntents: { create: async () => ({ id: "pi_paid_1", status: "succeeded" }) },
    }) as any);
    const inv = sentInvoiceFor(customerId, 200);

    const result = await attemptAutoBill(inv.id);
    expect(result.status).toBe("succeeded");

    const after = getInvoice(inv.id)!;
    expect(after.status).toBe("paid");
    expect(after.amount_paid).toBe(200);

    const attempts = attemptsFor(inv.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].status).toBe("succeeded");
    expect(attempts[0].gateway_reference).toBe("pi_paid_1");
    expect(attempts[0].next_retry_at).toBeNull();
  });

  test("a soft decline schedules a retry", async () => {
    setStripeClientResolver(async () => ({
      paymentIntents: {
        create: async () => {
          const e: any = new Error("insufficient funds");
          e.code = "insufficient_funds";
          throw e;
        },
      },
    }) as any);
    const inv = sentInvoiceFor(customerId, 75);

    const result = await attemptAutoBill(inv.id);
    expect(result.status).toBe("soft_failed");

    const attempts = attemptsFor(inv.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].next_retry_at).toBeTruthy();
    expect(getInvoice(inv.id)!.status).toBe("sent");
  });

  test("the final soft decline is terminal", async () => {
    setStripeClientResolver(async () => ({
      paymentIntents: {
        create: async () => {
          const e: any = new Error("insufficient funds");
          e.code = "insufficient_funds";
          throw e;
        },
      },
    }) as any);
    const inv = sentInvoiceFor(customerId, 80);

    await attemptAutoBill(inv.id, { attemptNo: 1 });
    await attemptAutoBill(inv.id, { attemptNo: 2 });
    await attemptAutoBill(inv.id, { attemptNo: 3 });

    const attempts = attemptsFor(inv.id);
    expect(attempts).toHaveLength(3);
    expect(attempts[2].next_retry_at).toBeNull();
  });

  test("a hard decline is terminal on the first attempt", async () => {
    setStripeClientResolver(async () => ({
      paymentIntents: {
        create: async () => {
          const e: any = new Error("card declined");
          e.code = "card_declined";
          throw e;
        },
      },
    }) as any);
    const inv = sentInvoiceFor(customerId, 90);

    const result = await attemptAutoBill(inv.id);
    expect(result.status).toBe("hard_failed");
    expect(attemptsFor(inv.id)[0].next_retry_at).toBeNull();
  });

  test("SCA is terminal on the first attempt", async () => {
    setStripeClientResolver(async () => ({
      paymentIntents: {
        create: async () => {
          const e: any = new Error("authentication required");
          e.code = "authentication_required";
          throw e;
        },
      },
    }) as any);
    const inv = sentInvoiceFor(customerId, 95);

    const result = await attemptAutoBill(inv.id);
    expect(result.status).toBe("requires_action");
    expect(attemptsFor(inv.id)[0].next_retry_at).toBeNull();
  });

  test("two ticks in the same window charge exactly once", async () => {
    let created = 0;
    setStripeClientResolver(async () => ({
      paymentIntents: {
        create: async () => {
          created++;
          return { id: "pi_once", status: "succeeded" };
        },
      },
    }) as any);
    const inv = sentInvoiceFor(customerId, 60);

    await attemptAutoBill(inv.id, { attemptNo: 1 });
    await attemptAutoBill(inv.id, { attemptNo: 1 });

    expect(created).toBe(1);
    expect(attemptsFor(inv.id)).toHaveLength(1);
    const payments = getDb()
      .query("SELECT * FROM payments WHERE invoice_id = ?")
      .all(inv.id) as any[];
    expect(payments).toHaveLength(1);
  });

  test("skips an invoice with no balance due", async () => {
    setStripeClientResolver(async () => ({
      paymentIntents: { create: async () => ({ id: "pi_nope", status: "succeeded" }) },
    }) as any);
    const inv = sentInvoiceFor(customerId, 40);
    await attemptAutoBill(inv.id);

    const second = await attemptAutoBill(inv.id, { attemptNo: 2 });
    expect(second.status).toBe("skipped");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/backend && bun test src/tests/auto-bill.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 3: Create the engine**

Create `packages/backend/src/services/auto-bill.service.ts`:

```ts
import crypto from "node:crypto";
import { getDb } from "../database/connection";
import { todayIso } from "../utils/date";
import { logger } from "../utils/logger";
import { logActivity } from "./activity.service";
import { getDefaultMethod } from "./customer-payment-method.service";
import { getInvoice } from "./invoice.service";
import { sendInvoiceEmail } from "./invoice-send.service";
import { dispatchEvent } from "./outgoing-webhooks.service";
import { getGateway } from "./payment-gateways/registry";
import { recordPayment } from "./payment.service";
import { getAllSettings, getSetting } from "./settings.service";
import type { OffSessionResult } from "./payment-gateways/types";

/** Days after a soft decline to retry. Index is attemptNo - 1. */
export const RETRY_OFFSET_DAYS = [1, 3] as const;
// 3 attempts in total, so only 2 retry delays are needed.
export const MAX_ATTEMPTS = 3;

export type AutoBillOutcome = OffSessionResult | { status: "skipped"; errorCode: string };

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function writeAttempt(row: {
  invoiceId: string;
  recurringId?: string;
  paymentMethodId?: string;
  attemptNo: number;
  status: string;
  reference?: string;
  errorCode?: string;
  errorMessage?: string;
  nextRetryAt: string | null;
}): void {
  try {
    getDb().run(
      `INSERT INTO auto_bill_attempts
         (id, invoice_id, recurring_id, payment_method_id, attempt_no,
          status, gateway_reference, error_code, error_message, next_retry_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomBytes(16).toString("hex"),
        row.invoiceId,
        row.recurringId ?? null,
        row.paymentMethodId ?? null,
        row.attemptNo,
        row.status,
        row.reference ?? null,
        row.errorCode ?? null,
        row.errorMessage ?? null,
        row.nextRetryAt,
      ],
    );
  } catch (err) {
    // ux_aba_invoice_attempt rejected a duplicate (invoice_id, attempt_no).
    // That means a concurrent tick already logged this attempt: a no-op.
    const msg = String(err);
    if (!msg.includes("UNIQUE") && !msg.includes("constraint")) throw err;
  }
}

/** Best-effort admin notification. Mirrors notifyInvoiceViewed exactly. */
async function notifyFailure(
  invoiceId: string,
  invoiceNumber: string,
  reason: string,
): Promise<void> {
  try {
    logActivity({
      user_id: null,
      user_name: "System",
      action: "auto_bill_failed",
      resource_type: "invoice",
      resource_id: invoiceId,
      metadata: { invoice_number: invoiceNumber, reason },
    });

    void dispatchEvent("invoice.auto_bill_failed", {
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      reason,
    });

    if (getSetting("notify_on_auto_bill_failure") !== "true") return;

    const { isEmailConfigured, sendEmail } = await import("./email.service");
    if (!(await isEmailConfigured())) return;
    const settings = getAllSettings();
    const to = settings.company_email;
    if (!to) return;

    await sendEmail({
      to,
      subject: `Auto-billing failed for invoice ${invoiceNumber}`,
      text: `The saved card for invoice ${invoiceNumber} could not be charged (${reason}). The customer has been emailed a payment link.`,
      html: `<p>The saved card for invoice <strong>${invoiceNumber}</strong> could not be charged (${reason}).</p><p>The customer has been emailed a payment link.</p>`,
    });
  } catch (err) {
    logger.warn({ err, invoiceId }, "Auto-bill failure notification did not send");
  }
}

/**
 * Attempt one off-session charge against the customer's default saved card.
 *
 * Every precondition failure is a clean "skipped" rather than an error: a
 * profile whose customer has no card is a normal state, not a fault. Terminal
 * failures leave the invoice `sent` with its payment link emailed, so the
 * customer can always pay by hand.
 */
export async function attemptAutoBill(
  invoiceId: string,
  opts: { recurringId?: string; attemptNo?: number } = {},
): Promise<AutoBillOutcome> {
  const attemptNo = opts.attemptNo ?? 1;

  const invoice = getInvoice(invoiceId);
  if (!invoice) return { status: "skipped", errorCode: "invoice_not_found" };
  if (["draft", "voided", "paid", "complete"].includes(invoice.status)) {
    return { status: "skipped", errorCode: `invoice_status_${invoice.status}` };
  }

  const balanceDue = invoice.total - (invoice.amount_paid || 0);
  if (balanceDue <= 0) return { status: "skipped", errorCode: "no_balance_due" };

  const method = getDefaultMethod(invoice.customer_id);
  if (!method) return { status: "skipped", errorCode: "no_saved_method" };

  const gateway = getGateway(method.gateway);
  if (!gateway?.supportsAutoBill || !gateway.chargeOffSession) {
    return { status: "skipped", errorCode: "gateway_cannot_auto_bill" };
  }

  const result = await gateway.chargeOffSession({
    invoiceId,
    amount: balanceDue,
    currency: invoice.currency,
    gatewayCustomerId: method.gateway_customer_id,
    gatewayMethodId: method.gateway_method_id,
    attemptNo,
  });

  // Only a soft failure with attempts left is non-terminal.
  const canRetry = result.status === "soft_failed" && attemptNo < MAX_ATTEMPTS;
  const nextRetryAt = canRetry ? isoDaysFromNow(RETRY_OFFSET_DAYS[attemptNo - 1]) : null;

  writeAttempt({
    invoiceId,
    recurringId: opts.recurringId,
    paymentMethodId: method.id,
    attemptNo,
    status: result.status,
    reference: result.reference,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    nextRetryAt,
  });

  if (result.status === "succeeded" && result.reference) {
    const recorded = recordPayment(invoiceId, {
      amount: balanceDue,
      payment_date: todayIso(),
      method: "card",
      reference: result.reference,
      notes: "Auto-billed via Stripe",
    });
    if (!recorded.success) {
      // The card was charged but the invoice cannot take the payment. Surface
      // loudly so ops can reconcile rather than losing money silently.
      logger.error(
        { invoiceId, reference: result.reference, error: recorded.error },
        "Auto-bill charge captured but not recorded",
      );
    }
    return result;
  }

  // Terminal failure: hand the customer a way to pay, and tell the merchant.
  if (!canRetry) {
    try {
      await sendInvoiceEmail(invoiceId, { attachEinvoice: true });
    } catch (err) {
      logger.warn({ err, invoiceId }, "Could not email the payment link after a failed charge");
    }
    await notifyFailure(invoiceId, invoice.invoice_number, result.errorCode ?? result.status);
  }

  return result;
}
```

- [ ] **Step 4: Allowlist the notification setting**

Add `"notify_on_auto_bill_failure",` to the settings key array in `packages/backend/src/routes/settings.ts` (the list ending at line 117), next to the other `notify_*` keys if present, otherwise alongside `peppol_auto_send`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd packages/backend && bun test src/tests/auto-bill.test.ts
```

Expected: 25 pass. If "two ticks charge exactly once" fails with 2 creations, the idempotency key from Task 8 is not being passed through; fix that rather than weakening the test.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/auto-bill.service.ts packages/backend/src/routes/settings.ts packages/backend/src/tests/auto-bill.test.ts
git commit -m "feat: charge saved cards with classified retries and fallback"
```

---

### Task 10: Wire generation and retries into the scheduler

**Files:**
- Modify: `packages/backend/src/services/auto-bill.service.ts`, `packages/backend/src/services/recurring.service.ts`, `packages/backend/src/services/scheduler.ts`
- Test: `packages/backend/src/tests/auto-bill.test.ts`, `packages/backend/src/tests/recurring-cron.test.ts`

**Interfaces:**
- Produces: `export async function processAutoBillRetries(): Promise<{ retried: number; succeeded: number }>;`

- [ ] **Step 1: Write the failing tests**

Append to `packages/backend/src/tests/auto-bill.test.ts`:

```ts
import { processAutoBillRetries } from "../services/auto-bill.service";

describe("processAutoBillRetries", () => {
  afterEach(() => setStripeClientResolver(null));

  test("retries only attempts whose next_retry_at has passed", async () => {
    let created = 0;
    setStripeClientResolver(async () => ({
      paymentIntents: {
        create: async () => {
          created++;
          return { id: `pi_retry_${created}`, status: "succeeded" };
        },
      },
    }) as any);

    const due = sentInvoiceFor(customerId, 30);
    const notDue = sentInvoiceFor(customerId, 30);
    const past = new Date(Date.now() - 3600_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();

    for (const [inv, when] of [[due, past], [notDue, future]] as const) {
      getDb().run(
        `INSERT INTO auto_bill_attempts
           (id, invoice_id, attempt_no, status, error_code, next_retry_at)
         VALUES (?, ?, 1, 'soft_failed', 'insufficient_funds', ?)`,
        [crypto.randomBytes(16).toString("hex"), inv.id, when],
      );
    }

    const result = await processAutoBillRetries();
    expect(result.retried).toBe(1);
    expect(getInvoice(due.id)!.status).toBe("paid");
    expect(getInvoice(notDue.id)!.status).toBe("sent");
  });

  test("a retried attempt is no longer due", async () => {
    setStripeClientResolver(async () => ({
      paymentIntents: { create: async () => ({ id: "pi_settled", status: "succeeded" }) },
    }) as any);

    const inv = sentInvoiceFor(customerId, 45);
    getDb().run(
      `INSERT INTO auto_bill_attempts
         (id, invoice_id, attempt_no, status, error_code, next_retry_at)
       VALUES (?, ?, 1, 'soft_failed', 'insufficient_funds', ?)`,
      [crypto.randomBytes(16).toString("hex"), inv.id, new Date(Date.now() - 3600_000).toISOString()],
    );

    await processAutoBillRetries();
    const second = await processAutoBillRetries();
    expect(second.retried).toBe(0);
  });
});
```

And to `packages/backend/src/tests/recurring-cron.test.ts`:

```ts
test("an auto_bill profile charges the saved card on generation", async () => {
  setStripeClientResolver(async () => ({
    paymentIntents: { create: async () => ({ id: "pi_recurring", status: "succeeded" }) },
  }) as any);
  saveMethod({
    customerId, gatewayCustomerId: "cus_rec", gatewayMethodId: "pm_rec", last4: "4242",
  });

  const template = createInvoice({
    customer_id: customerId, issue_date: todayMinus(30), currency: "USD",
    items: [{ description: "Retainer", quantity: 1, unit_price: 300 }],
  });
  const rec = createRecurring({
    customer_id: customerId, template_invoice_id: template.id,
    frequency: "monthly", next_run_date: todayMinus(1), auto_bill: true,
  });

  const invoiceId = await generateInvoice(rec.id);
  const generated = getInvoice(invoiceId!)!;
  expect(generated.status).toBe("paid");
  expect(generated.amount_paid).toBe(300);

  setStripeClientResolver(null);
});
```

Import `setStripeClientResolver`, `saveMethod`, and `getInvoice` into `recurring-cron.test.ts`.

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/backend && bun test src/tests/auto-bill.test.ts src/tests/recurring-cron.test.ts
```

Expected: FAIL, `processAutoBillRetries` is not exported, and the recurring invoice is `sent` rather than `paid`.

- [ ] **Step 3: Add the retry processor**

Append to `packages/backend/src/services/auto-bill.service.ts`:

```ts
/**
 * Re-run every attempt whose retry time has passed. The hourly scheduler means
 * a "+1 day" retry fires within an hour of its due time, which is ample for
 * dunning. Retrying the highest logged attempt number keeps the sequence and
 * the idempotency key monotonic.
 */
export async function processAutoBillRetries(): Promise<{
  retried: number;
  succeeded: number;
}> {
  const db = getDb();
  const now = new Date().toISOString();
  const due = db
    .query(
      `SELECT invoice_id, recurring_id, MAX(attempt_no) AS attempt_no
       FROM auto_bill_attempts
       WHERE next_retry_at IS NOT NULL AND next_retry_at <= ?
       GROUP BY invoice_id`,
    )
    .all(now) as { invoice_id: string; recurring_id: string | null; attempt_no: number }[];

  let retried = 0;
  let succeeded = 0;

  for (const row of due) {
    try {
      const result = await attemptAutoBill(row.invoice_id, {
        recurringId: row.recurring_id ?? undefined,
        attemptNo: row.attempt_no + 1,
      });
      retried++;
      if (result.status === "succeeded") succeeded++;

      // The old row is settled either way: its successor now owns the schedule.
      db.run(
        `UPDATE auto_bill_attempts SET next_retry_at = NULL
         WHERE invoice_id = ? AND attempt_no = ?`,
        [row.invoice_id, row.attempt_no],
      );
    } catch (err) {
      logger.error({ err, invoiceId: row.invoice_id }, "Auto-bill retry threw");
      db.run(
        `UPDATE auto_bill_attempts SET next_retry_at = NULL
         WHERE invoice_id = ? AND attempt_no = ?`,
        [row.invoice_id, row.attempt_no],
      );
    }
  }

  return { retried, succeeded };
}
```

- [ ] **Step 4: Hand off from generation**

In `packages/backend/src/services/recurring.service.ts`, inside `generateInvoice`, between the `publishInvoice` call and the `auto_send` block added in Task 3:

```ts
  // Charge before emailing: a successful charge means the customer receives a
  // paid invoice rather than a request for money they have already paid.
  let charged = false;
  if (recurring.auto_bill === 1) {
    try {
      const { attemptAutoBill } = await import("./auto-bill.service");
      const result = await attemptAutoBill(newInvoice.id, { recurringId });
      charged = result.status === "succeeded";
    } catch (err) {
      logger.error({ err, recurringId, invoiceId: newInvoice.id }, "Auto-bill threw on generation");
    }
  }
```

and change the `auto_send` guard to skip a paid invoice:

```ts
  if (recurring.auto_send === 1 && !charged) {
```

The dynamic import breaks a require cycle: `auto-bill.service` imports `invoice-send.service`, which does not import `recurring.service`, but keeping this lazy avoids a future cycle as both grow.

- [ ] **Step 5: Wire the scheduler**

In `packages/backend/src/services/scheduler.ts`, add after the recurring block inside `runScheduledTasks`, in its own try/catch so a Stripe outage cannot stop reminders:

```ts
  try {
    const { processAutoBillRetries } = await import("./auto-bill.service");
    const retries = await processAutoBillRetries();
    if (retries.retried > 0) {
      logger.info(
        { retried: retries.retried, succeeded: retries.succeeded },
        "Scheduler: auto-bill retries processed",
      );
    }
  } catch (err) {
    logger.error({ err }, "Scheduler auto-bill error");
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd packages/backend && bun test
```

Expected: the full suite passes, including the new retry and recurring-charge tests.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/auto-bill.service.ts packages/backend/src/services/recurring.service.ts packages/backend/src/services/scheduler.ts packages/backend/src/tests/
git commit -m "feat: run auto-billing on generation and on a retry schedule"
```

---

## Phase 3, Management surfaces

### Task 11: Portal payment-method endpoints

**Files:**
- Modify: `packages/backend/src/routes/public.ts`
- Test: `packages/backend/src/tests/auto-bill.test.ts`

**Interfaces:**
- Consumes: `listMethodsForCustomer`, `deleteMethod` (Task 6), `resolvePortalCustomer` (already in `public.ts`)
- Produces: `GET /api/v1/public/portal/:token/payment-methods`, `DELETE /api/v1/public/portal/:token/payment-methods/:id`

- [ ] **Step 1: Write the failing tests**

Append to `packages/backend/src/tests/auto-bill.test.ts`. These drive the composed app so the portal-token guard is exercised for real:

```ts
import { buildApp } from "../app";

describe("portal payment methods", () => {
  let app: ReturnType<typeof buildApp>;
  let portalToken: string;
  let portalCustomer: string;

  beforeAll(() => {
    app = buildApp();
    portalCustomer = crypto.randomBytes(16).toString("hex");
    portalToken = crypto.randomBytes(16).toString("hex");
    getDb().run("INSERT INTO customers (id, name, portal_enabled) VALUES (?, ?, 1)", [
      portalCustomer, "Portal Co",
    ]);
    getDb().run("INSERT INTO portal_tokens (customer_id, token) VALUES (?, ?)", [
      portalCustomer, portalToken,
    ]);
  });

  test("lists only safe display fields", async () => {
    saveMethod({
      customerId: portalCustomer, gatewayCustomerId: "cus_portal",
      gatewayMethodId: "pm_portal", brand: "visa", last4: "4242",
      expMonth: 6, expYear: 2032,
    });

    const res = await app.request(`/api/v1/public/portal/${portalToken}/payment-methods`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].last4).toBe("4242");
    expect(body.data[0].brand).toBe("visa");
    // Gateway identifiers must never reach the browser.
    expect(body.data[0].gateway_method_id).toBeUndefined();
    expect(body.data[0].gateway_customer_id).toBeUndefined();
  });

  test("rejects an unknown portal token", async () => {
    const res = await app.request("/api/v1/public/portal/not-a-token/payment-methods");
    expect(res.status).toBe(404);
  });

  test("a detach failure keeps the row", async () => {
    setStripeClientResolver(async () => ({
      paymentMethods: {
        detach: async () => {
          throw new Error("stripe is down");
        },
      },
    }) as any);

    const listed = await (
      await app.request(`/api/v1/public/portal/${portalToken}/payment-methods`)
    ).json();
    const id = listed.data[0].id;

    const res = await app.request(
      `/api/v1/public/portal/${portalToken}/payment-methods/${id}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(502);

    const still = await (
      await app.request(`/api/v1/public/portal/${portalToken}/payment-methods`)
    ).json();
    expect(still.data).toHaveLength(1);

    setStripeClientResolver(null);
  });

  test("a successful detach removes the row", async () => {
    setStripeClientResolver(async () => ({
      paymentMethods: { detach: async () => ({}) },
    }) as any);

    const listed = await (
      await app.request(`/api/v1/public/portal/${portalToken}/payment-methods`)
    ).json();
    const id = listed.data[0].id;

    const res = await app.request(
      `/api/v1/public/portal/${portalToken}/payment-methods/${id}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);

    const after = await (
      await app.request(`/api/v1/public/portal/${portalToken}/payment-methods`)
    ).json();
    expect(after.data).toHaveLength(0);

    setStripeClientResolver(null);
  });
});
```

Check the exported name of the app builder in `packages/backend/src/app.ts` and the `portal_tokens` column list in `migrations.ts` around line 394, and match them exactly.

- [ ] **Step 2: Run to verify it fails**

```bash
cd packages/backend && bun test src/tests/auto-bill.test.ts
```

Expected: FAIL, 404 on the list endpoint.

- [ ] **Step 3: Add the endpoints**

In `packages/backend/src/routes/public.ts`, after the existing `resolvePortalCustomer` helper:

```ts
publicRoutes.get("/portal/:token/payment-methods", (c) => {
  const customer = resolvePortalCustomer(c.req.param("token"));
  if (!customer) return c.json({ success: false, error: "Portal link not found or expired" }, 404);

  // Display metadata only. Gateway identifiers stay server-side: they are
  // chargeable references, not something a browser ever needs.
  const data = listMethodsForCustomer(customer.id).map((m) => ({
    id: m.id,
    brand: m.brand,
    last4: m.last4,
    exp_month: m.exp_month,
    exp_year: m.exp_year,
    is_default: m.is_default,
    created_at: m.created_at,
  }));

  return c.json({ success: true, data });
});

publicRoutes.delete("/portal/:token/payment-methods/:id", async (c) => {
  const customer = resolvePortalCustomer(c.req.param("token"));
  if (!customer) return c.json({ success: false, error: "Portal link not found or expired" }, 404);

  const result = await deleteMethod(c.req.param("id"), customer.id);
  if (!result.success) {
    // "Not found" is the caller's fault; anything else is the gateway's.
    const status = result.error === "Payment method not found" ? 404 : 502;
    return c.json({ success: false, error: result.error }, status);
  }
  return c.json({ success: true, data: { message: "Payment method removed" } });
});
```

Import `deleteMethod` and `listMethodsForCustomer` from `../services/customer-payment-method.service`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd packages/backend && bun test src/tests/auto-bill.test.ts
```

Expected: 31 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/routes/public.ts packages/backend/src/tests/auto-bill.test.ts
git commit -m "feat: let a customer see and revoke saved cards from the portal"
```

---

### Task 12: Frontend surfaces and docs

**Files:**
- Create: `packages/frontend/src/components/PaymentMethodList.tsx`
- Modify: `packages/frontend/src/pages/ClientPortal.tsx`, `packages/frontend/src/pages/CustomerView.tsx`, `packages/frontend/src/pages/RecurringInvoiceForm.tsx`, `packages/frontend/src/i18n/{en,tr,de,es,fr}.ts`, `docs/features/recurring.md`, `docs/features/payments.md`

**Interfaces:**
- Consumes: the endpoints from Task 11, `auto_bill` on the recurring API from Task 3

- [ ] **Step 1: Add the i18n keys**

Add to the `portal` namespace in `packages/frontend/src/i18n/en.ts`:

```ts
    saved_cards: "Saved cards",
    saved_cards_empty: "No saved cards. Tick \"save this card\" when you next pay an invoice.",
    remove_card: "Remove",
    remove_card_confirm: "Remove this card? Future invoices will not be charged automatically.",
    remove_card_failed: "Could not remove the card. Please try again.",
    card_line: "{{brand}} ending {{last4}}, expires {{month}}/{{year}}",
```

and to the `recurring` namespace:

```ts
    auto_bill: "Charge the saved card automatically",
    auto_bill_help: "When this profile fires, charge the customer's saved card. If the charge fails they are emailed a payment link.",
    auto_bill_no_card: "This customer has no saved card yet. They can save one when they next pay an invoice.",
```

Add all nine keys to `tr.ts`, `de.ts`, `es.ts`, and `fr.ts`, translated.

- [ ] **Step 2: Create the shared list component**

Create `packages/frontend/src/components/PaymentMethodList.tsx`, a presentational component taking `methods`, `onRemove`, and a `readOnly` flag. It renders brand, last4, expiry, and a default badge, using the `portal.card_line` key. Follow the styling conventions of an existing list component in the same directory; do not introduce a new UI dependency.

- [ ] **Step 3: Use it in the portal**

In `packages/frontend/src/pages/ClientPortal.tsx`, fetch `GET /api/v1/public/portal/:token/payment-methods` alongside the existing portal fetch, render a "Saved cards" section with `PaymentMethodList`, and wire removal to `DELETE …/payment-methods/:id` behind the existing confirm-dialog pattern. Show `saved_cards_empty` when the list is empty, and `remove_card_failed` on a non-200 response.

- [ ] **Step 4: Use it in the admin customer page**

In `packages/frontend/src/pages/CustomerView.tsx`, add the same section in read-only-plus-remove mode. It needs an authenticated admin endpoint; add `GET /api/v1/customers/:id/payment-methods` and `DELETE /api/v1/customers/:id/payment-methods/:methodId` to `packages/backend/src/routes/customers.ts`, delegating to the same `listMethodsForCustomer` and `deleteMethod` and returning the same reduced field set as the portal.

- [ ] **Step 5: Add the recurring toggle**

In `packages/frontend/src/pages/RecurringInvoiceForm.tsx`, add an `auto_bill` checkbox next to the existing `auto_send` one. Disable it with the `auto_bill_no_card` hint when the selected customer has no saved method, determined from the customer payment-methods endpoint added in Step 4.

- [ ] **Step 6: Verify in the browser**

```bash
cd /Users/baris/projects/inhouse/inkvoice-mono/inkvoice && bun run dev
```

Confirm each of these and screenshot them:
1. The recurring form shows the auto-bill toggle, disabled with the hint for a customer with no card.
2. The admin customer page lists a saved card (insert one directly into the dev database to have something to show).
3. Removing that card from the admin page empties the list.
4. The portal at `/portal/:token` shows the same card and its empty state after removal.

- [ ] **Step 7: Update the docs**

In `docs/features/recurring.md`, document `auto_send` (it now actually sends) and `auto_bill`, including that default profiles still generate drafts. In `docs/features/payments.md`, document saving a card at checkout, the retry schedule (+1, +3, +5 days, three attempts), what happens on SCA and hard declines, `PUBLIC_BASE_URL`, `notify_on_auto_bill_failure`, and that chargeback liability sits with the merchant operating the Stripe account.

- [ ] **Step 8: Full gate and commit**

```bash
cd /Users/baris/projects/inhouse/inkvoice-mono/inkvoice && bun run check
```

Expected: lint clean, typecheck clean, all tests pass.

```bash
git add packages/frontend/src packages/backend/src/routes/customers.ts docs/
git commit -m "feat: manage saved cards from the portal and the admin app"
```

---

### Task 13: Cloud overlay

**Files (in `inkvoice-cloud/`, a separate repo):**
- Create: `packages/backend/src/cloud/services/stripe-tenant.ts`, `packages/backend/src/tests/auto-bill-tenant.test.ts`
- Modify: `packages/backend/src/cloud/init.ts`, `packages/backend/src/cloud/routes/connect.ts`

**Interfaces:**
- Consumes: `setStripeClientResolver`, `setStripeConfiguredChecker` (Task 5), `saveMethodFromCheckoutSession` (Task 7)
- Produces: `export async function loadStripeForTenant(tenantId: string): Promise<{ stripe: Stripe; webhookSecret: string | null } | null>;`

- [ ] **Step 1: Sync the OSS changes into the overlay**

```bash
cd /Users/baris/projects/inhouse/inkvoice-mono/inkvoice-cloud && bun run dev:link:status
```

If it reports linked mode, run `bun run dev:unlink` first: the sync agent hard-aborts (exit 2) when it sees the symlink. Then:

```bash
cd /Users/baris/projects/inhouse/inkvoice-mono/inkvoice-cloud && git -C vendor/inkvoice-oss fetch origin && bun run sync
```

`sync:dry` reports "no-op (already at …)" even when there is a real gap, so fetch inside the submodule and compare before trusting it.

- [ ] **Step 2: Write the failing test**

Create `packages/backend/src/tests/auto-bill-tenant.test.ts`, copying the bootstrap and Stripe-mock structure from `packages/backend/src/tests/stripe-byo.test.ts` verbatim (control DB init, tenant map reset, `runWithTenantDbAsync`). Assert:

```ts
test("the resolver charges on the tenant's own key", async () => {
  // tenantA has stored key sk_test_A. A charge for tenantA must construct the
  // Stripe client with sk_test_A and no stripeAccount or application_fee.
  await runWithTenantDbAsync(tenantA, async () => {
    const result = await attemptAutoBill(invoiceInA);
    expect(result.status).toBe("succeeded");
  });
  expect(stripeMock.createCalls[0].key).toBe("sk_test_A");
  expect(stripeMock.createCalls[0].params.application_fee_amount).toBeUndefined();
});

test("a saved method in one tenant is invisible to another", async () => {
  await runWithTenantDbAsync(tenantA, async () => {
    saveMethod({
      customerId: customerInA, gatewayCustomerId: "cus_A",
      gatewayMethodId: "pm_A", last4: "4242",
    });
  });
  await runWithTenantDbAsync(tenantB, async () => {
    expect(listMethodsForCustomer(customerInA)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd /Users/baris/projects/inhouse/inkvoice-mono/inkvoice-cloud/packages/backend && bun test src/tests/auto-bill-tenant.test.ts
```

Expected: FAIL, no resolver is registered, so `getStripe()` falls back to an unset env key.

- [ ] **Step 4: Extract the tenant Stripe loader**

Move `loadStripeForTenant` out of `packages/backend/src/cloud/routes/connect.ts` into a new `packages/backend/src/cloud/services/stripe-tenant.ts`, exported unchanged, and import it back into `connect.ts`. Keep its doc comment: it explains the BYO trust model and must run inside the tenant DB context.

- [ ] **Step 5: Register the hooks at boot**

In `packages/backend/src/cloud/init.ts`, next to the existing `setRecurringLimitChecker` and `setTenantSmtpResolver` calls:

```ts
  // One auto-bill engine serves both deployments. Self-hosted uses its env key;
  // here every charge resolves the current tenant's own BYO key, so Pigon never
  // touches client funds and never acts as the merchant.
  setStripeClientResolver(async () => {
    const tenantId = getCurrentTenantId();
    if (!tenantId) return null;
    const loaded = await loadStripeForTenant(tenantId);
    return loaded?.stripe ?? null;
  });

  setStripeConfiguredChecker(() => {
    const row = getDb()
      .query("SELECT is_active FROM payment_credentials WHERE provider = 'stripe'")
      .get() as { is_active: number } | null;
    return !!row?.is_active;
  });
```

Use whatever accessor `cloud/middleware/tenant.ts` already exposes for the current tenant id; do not invent a new one.

- [ ] **Step 6: Capture cards in the cloud checkout**

`connect.ts` owns its own Checkout path, and OSS gateway webhooks return 410 in cloud mode, so the capture wiring has to be repeated here even though the logic is shared:

1. In the `/payment-session` handler, accept `save_card` and `consent_text` from the body and set `customer_creation: "always"`, `payment_intent_data: { setup_future_usage: "off_session" }`, and the `save_card` / `customer_id` / `consent_text` metadata, exactly as Task 7 does in `stripe.service.ts`.
2. In the tenant webhook handler and the redirect-confirm fast-path, call `await saveMethodFromCheckoutSession(session)` after `recordStripePayment(session)`.

Import `saveMethodFromCheckoutSession` from `@oss/backend/services/stripe.service`.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd /Users/baris/projects/inhouse/inkvoice-mono/inkvoice-cloud/packages/backend && bun test
```

Expected: the new tenant test passes and `stripe-byo.test.ts` still passes. Backend `tsc` shows spurious Hono overload errors under `dev:link` because two copies of Hono resolve; `bun test` is the real gate here, and submodule mode is the authoritative typecheck.

- [ ] **Step 8: Commit in the cloud repo**

```bash
cd /Users/baris/projects/inhouse/inkvoice-mono/inkvoice-cloud
git add packages/backend/src/cloud packages/backend/src/tests/auto-bill-tenant.test.ts
git commit -m "feat: auto-bill on each tenant's own Stripe account"
```

---

## Self-Review Notes

Checked against `docs/superpowers/specs/2026-09-04-auto-billing-design.md`:

- Every spec section maps to a task. Stripe client resolution → Task 5; gateway capability → Task 8; data model → Task 4 (migration 27 moved to Task 3, where `auto_bill` is first needed, so each task's schema arrives with its consumer); Phase 0 → Tasks 1-3; Phase 1 → Tasks 6-7; Phase 2 → Tasks 8-10; Phase 3 → Tasks 11-12; cloud overlay → Task 13; testing → folded into each task.
- Task 1 was added after the spec was written. Empirical check: a draft run through the route's publish/mark ordering ends `sent` with `is_published: 0` and `share_token: null`, so the delivery email carries no link. Every "email the payment link" fallback in the spec depends on that link existing.
- Migration numbering: 27 (`recurring_auto_bill`, Task 3), 28 (`customer_payment_methods`), 29 (`auto_bill_attempts`), 30 (`payments_reference_dedupe`). `LATEST_MIGRATION_VERSION` reaches 30, which Task 4's test asserts.
- Names are consistent across tasks: `saveMethod`, `getDefaultMethod`, `listMethodsForCustomer`, `deleteMethod`, `getMethodById`, `attemptAutoBill`, `processAutoBillRetries`, `chargeOffSession`, `classifyStripeError`, `saveMethodFromCheckoutSession`, `setStripeClientResolver`, `setStripeConfiguredChecker`, `resolvePublicOrigin`, `sendInvoiceEmail`.
- The spec says i18n changes touch `en.ts` / `tr.ts`. The repo has five locales; the plan and Global Constraints require all five.
