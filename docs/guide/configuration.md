# Configuration

Inkvoice is configured through environment variables. Copy `.env.example` to `.env` to get started.

## Required

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_USER` | `admin` | Initial admin username |
| `ADMIN_PASS` | `changeme` | Initial admin password |
| `JWT_SECRET` | — | JWT signing secret (min 32 characters) |

::: warning
Always set a strong `JWT_SECRET` in production. The default is only suitable for development.
:::

## Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_PATH` | `./data/invoice.db` | Path to the SQLite database file |

The database is created automatically on first run. Back it up by copying this file.

## Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Server bind address |

## Security

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_TTL` | `3600` | JWT token lifetime in seconds |
| `COOKIE_SECURE` | `true` | Use secure cookies (set to `false` for HTTP in development) |
| `ENABLE_HSTS` | `false` | Enable HSTS header |
| `RATE_LIMIT_ENABLED` | `true` | Enable login rate limiting |
| `RATE_LIMIT_MAX_ATTEMPTS` | `5` | Max failed login attempts before lockout |
| `RATE_LIMIT_WINDOW` | `900` | Rate limit window in seconds (15 min) |

## CORS

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:3000` | Comma-separated allowed origins |

Only needed if running the frontend dev server separately from the backend.

## Email (SMTP)

Optional. Enables sending invoices and quotes by email.

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | — | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `SMTP_FROM` | — | Sender email address |
| `SMTP_SECURE` | `false` | Use TLS (set to `true` for port 465) |

## Stripe (Online Payments)

Optional. Enables customers to pay invoices online via Stripe.

| Variable | Default | Description |
|----------|---------|-------------|
| `STRIPE_SECRET_KEY` | — | Stripe secret key (`sk_...`) |
| `STRIPE_PUBLISHABLE_KEY` | — | Stripe publishable key (`pk_...`) |
| `STRIPE_WEBHOOK_SECRET` | — | Stripe webhook signing secret (`whsec_...`) |

See [Online Payments](/features/payments) for setup instructions.

## PDF Generation

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROME_PATH` | (auto-detected) | Path to Chrome/Chromium binary |

Chrome Headless Shell is bundled in the Docker image. Only set this if running outside Docker with a custom Chrome installation.

## Demo Mode

| Variable | Default | Description |
|----------|---------|-------------|
| `DEMO_MODE` | `false` | Enable demo mode with sample data and periodic resets |
