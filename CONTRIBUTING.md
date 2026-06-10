# Contributing to Inkvoice

Thanks for considering a contribution! Inkvoice is small enough to keep onboarding fast — this doc captures everything you need to make a useful PR.

## Setup

You need [Bun](https://bun.sh/) (latest stable) installed. Inkvoice is a single repo with two workspaces: `packages/backend` (Hono + SQLite) and `packages/frontend` (React + Vite).

```bash
git clone <your-fork-url>
cd inkvoice
bun install
cp .env.example .env   # edit if you want non-default secrets

# In one terminal — backend on :3000
bun run dev:backend

# In another terminal — frontend dev server on :5173 (proxies /api to :3000)
bun run dev:frontend
```

Default login: `admin` / `changeme` (or whatever you set in `.env`).

The SQLite file lives at `./data/invoice.db` by default. Delete it any time and restart to wipe state. `bun run db:reset` re-seeds the dev DB with realistic demo data (5 customers, 25 invoices across statuses).

## Running checks

| Command                  | What it does                                                       |
| ------------------------ | ------------------------------------------------------------------ |
| `bun run lint`           | Biome lint pass over the whole repo.                               |
| `bun run lint:fix`       | Auto-fix everything Biome can.                                     |
| `bun run typecheck`      | Run `tsc --noEmit` against backend and frontend.                   |
| `bun run test`           | `bun test` against the backend (in-memory SQLite).                 |
| `bun run check`          | Lint + typecheck + tests in one go. Run this before opening a PR.  |

CI runs `lint`, `typecheck`, `test`, plus a Docker build on every PR. PRs that don't pass `bun run check` locally usually fail CI for the same reason.

## Coding conventions

These are baked into Biome and `tsconfig.json`, but the highlights:

- **TypeScript everywhere.** `any` is allowed but should be rare — prefer `unknown` and narrow.
- **No ORMs.** Use `bun:sqlite` directly with prepared statements (it's already a connection singleton — see `packages/backend/src/database/connection.ts`).
- **Validate at the API edge.** Every route body that touches user input goes through a Zod schema. See `packages/backend/src/routes/invoices.ts` for the pattern.
- **API responses are uniform.** `{ success: true, data: ... }` on success, `{ success: false, error: "..." }` on failure. The frontend's `ApiError` class in `packages/frontend/src/api/client.ts` reads this shape.
- **Currency.** Stored as `REAL` in SQLite. JS number precision is fine for invoicing.
- **Dates.** Stored as ISO 8601 strings (`TEXT`). Format on the way out via `formatDate` in `packages/frontend/src/lib/utils.ts` or `packages/backend/src/utils/format-date.ts`.
- **i18n.** No hardcoded user-facing strings — every visible string goes through `t("namespace.key")`. Add new keys to **both** `packages/frontend/src/i18n/en.ts` and `tr.ts` or `tsc` will fail.
- **shadcn/ui.** Install only the components we use; don't pull the whole library. Existing components live in `packages/frontend/src/components/ui/`.
- **No new top-level dependencies** without a clear justification — Inkvoice's selling point is its small footprint.

## Project structure

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full picture.

Quick orientation:

- `packages/backend/src/routes/` — one Hono router per resource.
- `packages/backend/src/services/` — business logic. Routes stay thin; services hold the SQL.
- `packages/backend/src/utils/` — pure helpers (tax math, invoice numbering, CSV, ZIP, etc.) — no DB access.
- `packages/frontend/src/pages/` — one component per route.
- `packages/frontend/src/components/` — shared UI; subdirectories per domain (`invoices/`, `customers/`, …).
- `packages/frontend/src/i18n/` — translation files.

## Pull request checklist

Before you open a PR:

- [ ] `bun run check` passes (lint + typecheck + tests).
- [ ] New backend logic has a `bun:test` covering it. Routes are tested via integration tests in `packages/backend/src/tests/` — copy an existing one as a template.
- [ ] New user-facing strings are added to **both** `en.ts` and `tr.ts`.
- [ ] If you added a settings field, it's also in the `ALLOWED_SETTINGS` set in `packages/backend/src/routes/settings.ts`.
- [ ] If you added a DB column, the migration in `packages/backend/src/database/migrations.ts` is idempotent (use the `pragma_table_info` pattern that's already there).
- [ ] PR description explains _why_ the change matters, not just _what_ it does.
- [ ] One change per PR. Don't bundle unrelated cleanups.

## Filing bugs and feature requests

Open an issue. For bugs, please include:

- Inkvoice version (commit SHA is fine).
- How you're running it (Docker, manual, Coolify, etc.).
- Browser + OS for frontend bugs.
- Reproduction steps. Screenshots help a lot for UI bugs.

For feature requests, describe the use case first — Inkvoice deliberately stays small, so we lean toward "the simplest thing that solves it" over generality.

## License

By contributing you agree that your contributions are licensed under the [MIT License](./LICENSE).
