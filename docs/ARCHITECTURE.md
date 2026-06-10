# Architecture

A short tour of how Inkvoice is put together — enough to find your way around and to know where new code belongs.

## Why this stack

Inkvoice is a self-hosted dashboard, so the constraint that drives every decision is **RAM at idle**. The whole stack is picked to keep a single container under 100 MB at rest.

| Concern    | Choice                              | Why                                                                   |
| ---------- | ----------------------------------- | --------------------------------------------------------------------- |
| Runtime    | Bun                                 | Native SQLite via `bun:sqlite` (zero-copy), faster cold starts.       |
| Server     | Hono v4                             | ~14 KB. No magic, no decorators, just typed handlers.                 |
| Database   | SQLite (`bun:sqlite`)               | One file. No external dependency. Fine for everything <100k invoices.|
| Frontend   | React 19 + Vite 6                   | Static SPA, served by the same Hono process. No SSR overhead.         |
| Styling    | Tailwind v4 + shadcn/ui             | Components ship as source, not a runtime — only what we use ends up in the bundle. |
| State      | Zustand                             | ~1 KB. We don't need React Query for two-dozen endpoints.             |
| Validation | Zod                                 | Same schemas can validate request bodies and infer TS types.          |
| PDF        | Headless Chrome + Mustache          | Templates are plain HTML — anyone can read and edit them.             |

The whole thing runs as **one process serving one binary**: `bun run start` boots Hono, which serves `/api/*` and falls through to the built React SPA for everything else.

## Repository layout

```
inkvoice/
├── packages/
│   ├── backend/                 # Hono + SQLite + business logic
│   │   └── src/
│   │       ├── index.ts          # Process entrypoint, serves API + static SPA
│   │       ├── app.ts            # Hono app composition (see below)
│   │       ├── routes/           # One Hono router per resource (thin)
│   │       ├── services/         # All SQL + business rules
│   │       ├── middleware/       # auth, rate limit, security headers, error handler
│   │       ├── database/         # connection singleton + migrations + seed
│   │       ├── utils/            # pure helpers (tax math, CSV, ZIP, JWT, …)
│   │       ├── types/            # Shared TS types (Invoice, Customer, …)
│   │       ├── xml/              # e-invoice XML profiles (UBL, Peppol, …)
│   │       └── tests/            # bun:test integration tests
│   └── frontend/                 # React SPA
│       └── src/
│           ├── main.tsx          # React root + i18n provider
│           ├── App.tsx           # Router, layout chrome, auth guard
│           ├── pages/            # One component per route
│           ├── components/       # Shared UI; subdirs by domain
│           │   ├── layout/       # Sidebar, Header, MainLayout
│           │   ├── ui/           # shadcn primitives
│           │   ├── shared/       # DataTable, ConfirmDialog, EmptyState, …
│           │   └── invoices|customers|products|dashboard/
│           ├── stores/           # Zustand stores (auth, settings)
│           ├── hooks/            # use-persistent-state, use-theme, …
│           ├── lib/              # cn(), formatters, recently-viewed
│           ├── api/client.ts     # The single typed fetch wrapper
│           └── i18n/             # en.ts, tr.ts, useTranslation()
├── templates/                    # Bundled invoice templates (HTML + Mustache)
├── docs/                         # This directory
└── scripts/                      # dev bootstrap, db reset
```

## Request lifecycle

```
Browser ──> Hono (port 3000) ──> match against /api/v1/*
              │
              ├── /health                                        — never authed
              ├── /api/v1/auth/*       (login, me, logout)       — never authed
              ├── /api/v1/public/*     (share tokens, portal)    — never authed
              ├── /api/v1/webhooks/*   (Stripe, PayPal)          — verified by signature
              │
              ├── authMiddleware                                 — JWT → c.get("user")
              ├── adminOnly  (only for /users, /settings, /export)
              └── route handler ──> service ──> bun:sqlite ──> { success, data }
```

Anything that isn't an API route falls through to the SPA fallback (`index.html`), so client-side routing handles `/invoices/123/edit` and friends.

## Where to put new code

| Adding…                                                | Goes in                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| A new resource (e.g. "expenses")                       | `routes/expenses.ts`, `services/expense.service.ts`, `types/expense.ts`, register in `app.ts`. Add a migration in `database/migrations.ts`. |
| A new endpoint on an existing resource                 | New handler in the existing route file; logic in the matching service. |
| A new pure helper (no DB, no env)                      | `utils/`. Add a `bun:test` next to it.                     |
| A new setting                                          | Add to `ALLOWED_SETTINGS` in `routes/settings.ts`. Settings table is key/value, no migration needed. |
| A new DB column                                        | An idempotent `ALTER TABLE` block at the bottom of `database/migrations.ts` (use the `pragma_table_info` pattern). |
| A new page                                             | `pages/Foo.tsx` + a route in `App.tsx`.                    |
| A new shared component                                 | `components/shared/` (cross-domain) or `components/<domain>/`. |
| New user-facing strings                                | **Both** `i18n/en.ts` (source of truth) and `i18n/tr.ts`. |
| A new bundled template                                 | A folder under `templates/` with `template.html`, `style.css`, `manifest.json`. |
| A new e-invoice profile                                | A module under `packages/backend/src/xml/profiles/`, registered from `xml/init.ts`. |

## Conventions worth knowing

- **Routes stay thin.** Parse + validate the body, call the service, return the response shape. No SQL in route files.
- **Services own SQL.** Each service exports plain functions; no classes, no DI. Use prepared statements (`db.query(...).get(...)`) — Bun caches them at the C level.
- **Response shape.** `{ success: true, data: ... }` on success, `{ success: false, error: "..." }` on failure. The frontend's `ApiError` reads this shape directly.
- **Errors throw.** Routes can `throw new HttpError(status, message)`; the global `errorHandler` middleware turns those into JSON. Don't catch and return — let it bubble.
- **Currency.** Stored as `REAL`. JS double precision is fine for invoicing.
- **Dates.** Stored as ISO 8601 strings (`TEXT`). Compare lexically, format with `Intl.DateTimeFormat`.
- **Money formatting.** Always go through `formatCurrency()` in `lib/utils.ts` (frontend) or `utils/currency.ts` (backend) so locale and number-format settings are respected.
- **i18n.** Translation keys are the type source — the `TranslationKeys` type is derived from `en.ts`, so any missing key in `tr.ts` fails the typecheck.
- **Frontend state.** UI-local state in components. Cross-page state in Zustand. Server data is fetched directly through `api.client.ts` — we don't use a query cache library.
- **Persistent UI prefs.** Use `usePersistentState(key, initial)` in `hooks/use-persistent-state.ts` instead of touching `localStorage` directly.

## Tests

- Unit tests live next to their target (`utils/tax-calculator.test.ts` etc.).
- Integration tests live in `packages/backend/src/tests/` — they spin up a real Hono app with an in-memory SQLite DB and hit endpoints over `app.fetch()`.
- Frontend tests are deliberately minimal — most regressions are caught by typecheck + Biome + backend integration tests. Feature correctness is verified manually against the dev server.

Run the full pre-PR sweep with `bun run check`.
