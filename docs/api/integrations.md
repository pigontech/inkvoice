# Integrations (Zapier / Make / scripts)

Inkvoice exposes its full REST API to external tools through **API tokens** and
**polling endpoints**. This page covers the end-to-end workflow for connecting an
automation platform such as [Zapier](https://zapier.com) or
[Make](https://www.make.com), or your own scripts.

## 1. Generate an API token

In the app, go to **Settings → API → Generate token**. Give it a name (e.g.
`Zapier`) and either:

- leave **Full access** checked — the token can do anything your account can; or
- uncheck it and pick specific **scopes** (per resource: read and/or write).

The token is displayed **once**, in the form `ink_…`. Copy it immediately — it
is stored only as a hash and cannot be retrieved again. If you lose it, revoke
it and generate a new one.

## 2. Authenticate requests

Send the token in the `Authorization` header on every request:

```bash
curl https://your-inkvoice.example.com/api/v1/invoices \
  -H "Authorization: Bearer ink_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

That's the only difference from a normal session — every endpoint documented in
this API reference works the same way with a token.

## 3. Scopes

Scoped tokens are restricted to an allow-list of `resource:action` pairs. The
available resources are `invoices`, `customers`, `quotes`, `products`, and
`expenses`; the actions are `read` and `write` (write implies read on the same
resource).

| Request | Required scope |
|---|---|
| `GET /api/v1/invoices` | `invoices:read` |
| `POST /api/v1/invoices` | `invoices:write` |
| `GET /api/v1/customers` | `customers:read` |

A scoped token that hits a resource it wasn't granted — or a non-integration
area such as `settings` or `users` — receives `403 Forbidden`. A **full-access**
token (created with no scopes) is not restricted.

## 4. Polling for changes (`updated_since`)

For "new or updated record" triggers, poll the list endpoints with an
`updated_since` query parameter. It returns only rows whose `updated_at` is at or
after the given ISO-8601 timestamp:

```
GET /api/v1/invoices?updated_since=2026-06-08T00:00:00Z
GET /api/v1/customers?updated_since=2026-06-08T00:00:00Z
GET /api/v1/quotes?updated_since=2026-06-08T00:00:00Z
```

Typical polling loop:

1. Store the timestamp of your last successful poll.
2. Request `?updated_since=<last_poll>`.
3. Process the returned records (dedupe by `id` — a record may appear again if it
   changes within the same second).
4. Save the new poll time and repeat.

`updated_since` combines with the other list filters (`status`, `customer_id`,
`page`, `limit`, …) documented on each resource page.

## 5. Revoking a token

In **Settings → API**, use the trash icon next to a token to revoke it. Any
integration using that token stops working immediately. Revocation is permanent.

## Webhooks (push instead of poll)

If you'd rather be notified than poll, Inkvoice can also **push** events
(`invoice.paid`, `invoice.sent`, …) to an outgoing webhook URL. Configure these
under **Settings → Email → Outgoing webhooks**.
