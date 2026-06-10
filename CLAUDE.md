# CLAUDE.md — Autonomous Development Guide

## Project: Inkvoice (Open Source)

An open-source, self-hosted invoicing dashboard. Lightweight, modern, and designed for deployment on Dokploy or Coolify.

---

## Tech Stack

### Runtime & Backend
- **Runtime**: Bun (latest stable)
- **Framework**: Hono v4 — ultra-lightweight (~14KB), fast, TypeScript-first
- **Database**: SQLite via `bun:sqlite` (native zero-copy bindings, no external dependency)
- **Auth**: JWT via `hono/jwt` + bcrypt for password hashing
- **Validation**: Zod for request/response validation

### Frontend
- **Framework**: React 19 + Vite 6
- **Routing**: React Router v7 (SPA mode)
- **Styling**: Tailwind CSS v4 + shadcn/ui components
- **State**: Zustand (lightweight, ~1KB)
- **Icons**: Lucide React
- **Charts**: Recharts (lightweight charting)
- **HTTP Client**: Built-in fetch with a typed API client wrapper

### PDF Generation
- **Primary**: Puppeteer with Chrome Headless Shell
- **Templates**: Mustache (handlebars-compatible, logic-less templates)

### Build & Deploy
- **Monorepo**: Single repo, `packages/backend` + `packages/frontend`
- **Build**: Vite builds frontend to static files; Hono serves both API + static
- **Docker**: Single Dockerfile, single container (Bun serves everything)
- **Target RAM**: 50-100MB base, 200-400MB peak during PDF generation

### Why This Stack (vs Next.js)
- **Next.js**: 200-400MB base RAM, heavy for self-hosted. Overkill for a dashboard.
- **Hono + React SPA on Bun**: 50-100MB base RAM. Bun's native SQLite is zero-copy. Hono is 14KB. Static React build adds 0 server RAM.
- **Single container**: Hono serves the API at `/api/*` and the built React SPA for everything else. No nginx, no reverse proxy complexity.
- **Result**: 2-4x lighter than Next.js while maintaining modern React DX.

---

## Project Structure

```
inkvoice/
├── CLAUDE.md                    # This file
├── package.json                 # Root workspace config
├── bunfig.toml                  # Bun configuration
├── Dockerfile                   # Single-stage production build
├── docker-compose.yml           # Production compose
├── docker-compose.dev.yml       # Development compose
├── .env.example                 # Environment variable template
├── .gitignore
├── LICENSE                      # MIT License
├── README.md                    # User-facing documentation
│
├── packages/
│   ├── backend/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts              # Entry point — Hono app + static serving
│   │       ├── app.ts                # Hono app setup (middleware, routes)
│   │       ├── database/
│   │       │   ├── connection.ts      # SQLite connection singleton
│   │       │   ├── migrations.ts      # Schema migrations (versioned)
│   │       │   └── seed.ts            # Default data seeding
│   │       ├── routes/
│   │       │   ├── auth.ts            # POST /api/v1/auth/login, /logout
│   │       │   ├── invoices.ts        # CRUD + publish/void/duplicate/pdf
│   │       │   ├── customers.ts       # CRUD
│   │       │   ├── products.ts        # CRUD + categories + units
│   │       │   ├── templates.ts       # CRUD + install + preview
│   │       │   ├── settings.ts        # GET/PUT business settings
│   │       │   ├── tax.ts             # Tax definitions CRUD
│   │       │   ├── users.ts           # User management + permissions
│   │       │   ├── dashboard.ts       # Dashboard stats + chart data
│   │       │   └── public.ts          # Public invoice view + PDF download
│   │       ├── middleware/
│   │       │   ├── auth.ts            # JWT verification + permission check
│   │       │   ├── rate-limiter.ts    # Login brute-force protection
│   │       │   ├── security.ts        # Security headers (CSP, HSTS, etc.)
│   │       │   └── error-handler.ts   # Global error handling
│   │       ├── services/
│   │       │   ├── invoice.service.ts  # Invoice business logic
│   │       │   ├── customer.service.ts
│   │       │   ├── product.service.ts
│   │       │   ├── template.service.ts
│   │       │   ├── auth.service.ts
│   │       │   ├── settings.service.ts
│   │       │   ├── tax.service.ts
│   │       │   ├── user.service.ts
│   │       │   ├── pdf.service.ts      # HTML-to-PDF via Chrome Headless
│   │       │   └── dashboard.service.ts
│   │       ├── utils/
│   │       │   ├── jwt.ts
│   │       │   ├── password.ts
│   │       │   ├── invoice-number.ts  # Number pattern generation
│   │       │   ├── tax-calculator.ts  # Tax computation logic
│   │       │   ├── currency.ts        # Currency formatting
│   │       │   └── env.ts             # Env config with defaults
│   │       └── types/
│   │           ├── invoice.ts
│   │           ├── customer.ts
│   │           ├── product.ts
│   │           ├── settings.ts
│   │           ├── user.ts
│   │           └── common.ts
│   │
│   └── frontend/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       ├── tailwind.config.ts
│       └── src/
│           ├── main.tsx               # React entry point
│           ├── App.tsx                # Router setup
│           ├── api/
│           │   └── client.ts          # Typed API client (fetch wrapper)
│           ├── stores/
│           │   ├── auth.store.ts      # Auth state (Zustand)
│           │   └── settings.store.ts  # App settings cache
│           ├── hooks/
│           │   ├── use-invoices.ts
│           │   ├── use-customers.ts
│           │   ├── use-products.ts
│           │   └── use-dashboard.ts
│           ├── pages/
│           │   ├── Dashboard.tsx       # Overview with charts
│           │   ├── Invoices.tsx        # Invoice list + filters
│           │   ├── InvoiceForm.tsx     # Create/edit invoice
│           │   ├── InvoiceView.tsx     # Invoice detail view
│           │   ├── Customers.tsx       # Customer list
│           │   ├── CustomerForm.tsx    # Create/edit customer
│           │   ├── Products.tsx        # Product/service list
│           │   ├── ProductForm.tsx     # Create/edit product
│           │   ├── Templates.tsx       # Invoice template manager
│           │   ├── TemplateEditor.tsx  # HTML template editor
│           │   ├── Settings.tsx        # Business settings
│           │   ├── Users.tsx           # User management (admin)
│           │   ├── Login.tsx           # Auth page
│           │   └── PublicInvoice.tsx   # Public shareable invoice view
│           ├── components/
│           │   ├── ui/                # shadcn/ui components
│           │   ├── layout/
│           │   │   ├── Sidebar.tsx
│           │   │   ├── Header.tsx
│           │   │   ├── MainLayout.tsx
│           │   │   └── PublicLayout.tsx
│           │   ├── invoices/
│           │   │   ├── InvoiceTable.tsx
│           │   │   ├── InvoiceLineItems.tsx
│           │   │   ├── InvoiceStatusBadge.tsx
│           │   │   ├── InvoiceTotals.tsx
│           │   │   └── InvoiceFilters.tsx
│           │   ├── customers/
│           │   │   └── CustomerTable.tsx
│           │   ├── products/
│           │   │   └── ProductTable.tsx
│           │   ├── dashboard/
│           │   │   ├── RevenueChart.tsx
│           │   │   ├── InvoiceStatusChart.tsx
│           │   │   ├── RecentInvoices.tsx
│           │   │   └── StatCards.tsx
│           │   └── shared/
│           │       ├── DataTable.tsx
│           │       ├── ConfirmDialog.tsx
│           │       ├── SearchInput.tsx
│           │       ├── Pagination.tsx
│           │       └── EmptyState.tsx
│           ├── lib/
│           │   ├── utils.ts           # cn() helper, formatters
│           │   └── constants.ts       # App constants
│           └── styles/
│               └── globals.css        # Tailwind imports + custom styles
│
├── templates/                        # Built-in invoice HTML templates
│   ├── default/
│   │   ├── template.html             # Mustache template
│   │   ├── style.css                 # Template styles
│   │   └── manifest.json             # Template metadata
│   └── modern/
│       ├── template.html
│       ├── style.css
│       └── manifest.json
│
└── scripts/
    ├── dev.ts                        # Development server (concurrent backend + frontend)
    └── migrate.ts                    # Run database migrations
```

---

## Database Schema

### Core Tables

```sql
-- Business settings (key-value store)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Customers
CREATE TABLE customers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT,   -- ISO 3166-1 alpha-2
  tax_id TEXT,    -- VAT/GST number
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Products / Services
CREATE TABLE products (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  description TEXT,
  sku TEXT,
  unit_price REAL NOT NULL DEFAULT 0,
  unit TEXT DEFAULT 'piece',       -- piece, hour, day, kg, meter, lump_sum
  category TEXT DEFAULT 'service', -- service, goods, subscription, other
  tax_id TEXT REFERENCES tax_definitions(id),
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Tax definitions
CREATE TABLE tax_definitions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,          -- e.g. "VAT 20%", "GST 10%"
  rate REAL NOT NULL,          -- e.g. 20.0 for 20%
  description TEXT,
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Invoices
CREATE TABLE invoices (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  invoice_number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  status TEXT DEFAULT 'draft',  -- draft, sent, paid, overdue, voided
  issue_date TEXT NOT NULL,
  due_date TEXT,
  subtotal REAL DEFAULT 0,
  tax_total REAL DEFAULT 0,
  discount_type TEXT,           -- percentage, amount
  discount_value REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  notes TEXT,
  payment_terms TEXT,
  currency TEXT DEFAULT 'USD',
  share_token TEXT UNIQUE,      -- For public sharing
  template_id TEXT REFERENCES templates(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Invoice line items
CREATE TABLE invoice_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id),
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  unit TEXT DEFAULT 'piece',
  tax_id TEXT REFERENCES tax_definitions(id),
  tax_rate REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  line_total REAL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Invoice templates
CREATE TABLE templates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  description TEXT,
  html_content TEXT NOT NULL,
  css_content TEXT,
  type TEXT DEFAULT 'custom',   -- builtin, custom
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  username TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- User permissions (RBAC)
CREATE TABLE user_permissions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,   -- invoices, customers, products, templates, settings, tax_definitions, users
  action TEXT NOT NULL,     -- read, create, update, delete, publish, void, export
  UNIQUE(user_id, resource, action)
);
```

### Indexes

```sql
CREATE INDEX idx_invoices_number ON invoices(invoice_number);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_share_token ON invoices(share_token);
CREATE INDEX idx_invoices_issue_date ON invoices(issue_date);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX idx_products_active ON products(is_active);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_active ON users(is_active);
CREATE INDEX idx_user_permissions_user ON user_permissions(user_id);
CREATE INDEX idx_tax_definitions_active ON tax_definitions(is_active);
```

---

## API Endpoints

### Authentication
- `POST /api/v1/auth/login` — Login, returns JWT token
- `POST /api/v1/auth/logout` — Logout (client-side token removal)
- `GET  /api/v1/auth/me` — Get current user info

### Invoices
- `GET    /api/v1/invoices` — List invoices (filterable by status, date range, customer)
- `POST   /api/v1/invoices` — Create invoice
- `GET    /api/v1/invoices/:id` — Get invoice with items
- `PUT    /api/v1/invoices/:id` — Update invoice
- `DELETE /api/v1/invoices/:id` — Delete invoice (draft only)
- `POST   /api/v1/invoices/:id/publish` — Publish invoice (generates share token)
- `POST   /api/v1/invoices/:id/void` — Void invoice
- `POST   /api/v1/invoices/:id/duplicate` — Duplicate invoice as new draft
- `POST   /api/v1/invoices/:id/mark-paid` — Mark as paid
- `POST   /api/v1/invoices/:id/mark-sent` — Mark as sent
- `GET    /api/v1/invoices/:id/pdf` — Generate/download PDF
- `GET    /api/v1/invoices/next-number` — Get next invoice number

### Customers
- `GET    /api/v1/customers` — List customers (searchable)
- `POST   /api/v1/customers` — Create customer
- `GET    /api/v1/customers/:id` — Get customer with invoice summary
- `PUT    /api/v1/customers/:id` — Update customer
- `DELETE /api/v1/customers/:id` — Delete customer (if no invoices)

### Products / Services
- `GET    /api/v1/products` — List products (filterable by category, active)
- `POST   /api/v1/products` — Create product
- `GET    /api/v1/products/:id` — Get product
- `PUT    /api/v1/products/:id` — Update product
- `DELETE /api/v1/products/:id` — Delete product (soft deactivate if used)

### Tax Definitions
- `GET    /api/v1/tax-definitions` — List tax definitions
- `POST   /api/v1/tax-definitions` — Create tax definition
- `PUT    /api/v1/tax-definitions/:id` — Update tax definition
- `DELETE /api/v1/tax-definitions/:id` — Delete tax definition

### Templates
- `GET    /api/v1/templates` — List templates
- `POST   /api/v1/templates` — Create template
- `GET    /api/v1/templates/:id` — Get template
- `PUT    /api/v1/templates/:id` — Update template
- `DELETE /api/v1/templates/:id` — Delete template (not builtin)
- `PUT    /api/v1/templates/:id/default` — Set as default
- `POST   /api/v1/templates/:id/preview` — Preview template with sample data

### Settings
- `GET    /api/v1/settings` — Get all settings
- `PUT    /api/v1/settings` — Update settings (batch)
- `POST   /api/v1/settings/logo` — Upload company logo

### Users (Admin only)
- `GET    /api/v1/users` — List users
- `POST   /api/v1/users` — Create user
- `PUT    /api/v1/users/:id` — Update user
- `DELETE /api/v1/users/:id` — Delete user
- `PUT    /api/v1/users/:id/permissions` — Update user permissions

### Dashboard
- `GET    /api/v1/dashboard/stats` — Overview stats (total revenue, invoice counts by status, etc.)
- `GET    /api/v1/dashboard/revenue-chart` — Monthly revenue data for charts
- `GET    /api/v1/dashboard/recent-invoices` — Last 10 invoices

### Public (No auth required)
- `GET    /api/v1/public/invoices/:shareToken` — View shared invoice
- `GET    /api/v1/public/invoices/:shareToken/pdf` — Download shared invoice PDF

### Health
- `GET    /health` — Health check

---

## Environment Variables

```bash
# Required
ADMIN_USER=admin                     # Initial admin username
ADMIN_PASS=changeme                  # Initial admin password
JWT_SECRET=your-secret-key-min-32    # JWT signing secret (min 32 chars)

# Database
DATABASE_PATH=./data/invoice.db      # SQLite database file path

# Server
PORT=3000                            # Server port
HOST=0.0.0.0                         # Server host

# Security
SESSION_TTL=3600                     # JWT token lifetime in seconds (default: 1 hour)
COOKIE_SECURE=true                   # Use secure cookies (false for HTTP dev)
ENABLE_HSTS=false                    # Enable HSTS header
RATE_LIMIT_ENABLED=true              # Enable login rate limiting
RATE_LIMIT_MAX_ATTEMPTS=5            # Max failed login attempts
RATE_LIMIT_WINDOW=900                # Rate limit window in seconds

# PDF
CHROME_PATH=                         # Chrome/Chromium path (auto-detected)

# Optional
DEMO_MODE=false                      # Enable demo mode with periodic resets
```

---

## Design Principles

1. **RAM First**: Every library choice prioritizes memory efficiency. No ORMs, no heavy frameworks.
2. **Single Container**: One Dockerfile, one process. Hono serves API + static React build.
3. **Progressive Enhancement**: Start with core CRUD, then layer on polish features.
4. **Type Safety**: Full TypeScript, Zod validation on API boundaries.
5. **No Over-Engineering**: Direct SQL queries, simple service layer, no abstract repository patterns.
6. **Self-Hosted Friendly**: Works behind reverse proxy, supports custom domains, easy Docker deploy.

---

## Coding Conventions

- Use `bun:sqlite` for all database operations (native, zero-copy)
- Use prepared statements for all queries (performance + safety)
- Use Zod schemas that mirror the database tables for validation
- API responses follow: `{ success: true, data: ... }` or `{ success: false, error: "..." }`
- Use ISO 8601 dates everywhere (stored as TEXT in SQLite)
- UUIDs for all IDs (hex-encoded random bytes)
- Frontend uses React Query pattern via custom hooks (but with simple fetch, no React Query library — keep it light)
- Components use shadcn/ui primitives — install only what we use
- All monetary values stored as REAL in SQLite (JavaScript number precision is fine for invoicing)

---

## Multi-Language / i18n

The app supports multiple languages via a lightweight, custom i18n system (no external libraries).

### Current Languages
- **English (en)** — default
- **Turkish (tr)**

### Architecture
- Translation files: `packages/frontend/src/i18n/en.ts` (English, source of truth for types) and `packages/frontend/src/i18n/tr.ts`
- Context & hook: `packages/frontend/src/i18n/index.ts` exports `useTranslation()` hook
- Provider: `packages/frontend/src/i18n/I18nProvider.tsx` wraps the app in `main.tsx`
- Language preference stored in `localStorage` under key `inkvoice-lang`
- Language switcher in the Header component (globe icon)

### Translation Key Structure
Keys are organized by namespace in a nested object: `common`, `nav`, `auth`, `dashboard`, `invoices`, `customers`, `products`, `quotes`, `recurring`, `reports`, `settings`, `users`, `activity`, `templates`, `payment`, `public`, `send_dialog`, `record_payment`, `batch`.

### How to Use
```tsx
import { useTranslation } from "@/i18n";

function MyComponent() {
  const { t } = useTranslation();
  return <h1>{t("dashboard.title")}</h1>;
}

// With interpolation:
t("common.page_of", { page: "1", total: "5" }) // "Page 1 of 5"
```

### Rules for Adding/Changing UI Text
1. **Never hardcode user-facing strings** in components. Always use `t("key")`.
2. **When adding new text**, add the key to BOTH `en.ts` and `tr.ts` simultaneously.
3. `en.ts` is the **type source** — `tr.ts` implements `TranslationKeys` from `en.ts` to ensure type safety.
4. **After any file with UI text is changed**, verify all translations are present in both language files.
5. **Key naming**: use `namespace.descriptive_key` format (e.g., `invoices.new_invoice`, `common.save`).
6. **Interpolation**: use `{{variable}}` syntax in translation strings (e.g., `"Page {{page}} of {{total}}"`).

### Adding a New Language
1. Create `packages/frontend/src/i18n/{code}.ts` implementing `TranslationKeys` from `en.ts`.
2. Register it in `packages/frontend/src/i18n/index.ts`:
   - Add to the `Language` type union
   - Add to the `languages` record (code → display name)
   - Add to the `translations` record
3. The language will automatically appear in the Header language switcher.

---

## Testing Strategy

- Backend: Use `bun:test` for unit tests on services and utilities
- API: Integration tests hitting actual endpoints with in-memory SQLite
- Frontend: Minimal — focus on backend correctness
- No E2E tests initially — add later if needed

---

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
