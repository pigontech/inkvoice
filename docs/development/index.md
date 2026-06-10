# Contributing

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) (latest stable)
- [Node.js](https://nodejs.org) 18+ (for VitePress docs only)
- Git

### Clone and Install

```bash
git clone https://github.com/pigontech/inkvoice.git
cd inkvoice
bun install
```

### Start Development Servers

```bash
# Start both backend and frontend with hot reload
bun run dev
```

- Backend API: `http://localhost:3000`
- Frontend dev server: `http://localhost:5173`

The frontend dev server proxies API requests to the backend.

## Project Structure

```
inkvoice/
├── packages/
│   ├── backend/       # Hono API server
│   │   └── src/
│   │       ├── routes/       # API route handlers
│   │       ├── services/     # Business logic
│   │       ├── database/     # SQLite connection, migrations, seeds
│   │       ├── middleware/    # Auth, rate limiting, security
│   │       ├── utils/        # Helpers (JWT, currency, etc.)
│   │       └── types/        # TypeScript type definitions
│   └── frontend/      # React SPA
│       └── src/
│           ├── pages/        # Page components
│           ├── components/   # Reusable UI components
│           ├── hooks/        # Data fetching hooks
│           ├── stores/       # Zustand state stores
│           ├── api/          # Typed API client
│           ├── i18n/         # Translation files
│           └── lib/          # Utilities and constants
├── templates/         # Built-in invoice HTML templates
├── docs/              # This documentation site (VitePress)
└── scripts/           # Dev and migration scripts
```

## Running Tests

```bash
bun test
```

Tests use `bun:test` with in-memory SQLite databases.

## Building

```bash
# Build frontend for production
bun run build

# Type check
bun run typecheck

# Lint
bun run lint

# Lint and fix
bun run lint:fix
```

## Code Style

- TypeScript everywhere
- [Biome](https://biomejs.dev) for linting and formatting
- Direct SQL queries — no ORM
- Zod schemas for API validation
- shadcn/ui components for the frontend

## Adding Translations

Inkvoice supports multiple languages. When adding or changing user-facing text:

1. Use `t("namespace.key")` instead of hardcoded strings
2. Add the key to both `packages/frontend/src/i18n/en.ts` and `tr.ts`
3. English (`en.ts`) is the type source — Turkish (`tr.ts`) must match its shape

## Database Migrations

Migrations are in `packages/backend/src/database/migrations.ts` and run automatically on startup. Add new migrations to the array with an incrementing version number.
