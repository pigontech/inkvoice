# Configuration

Inkvoice is configured through environment variables. Copy `.env.example` to `.env` to get started.

## Required

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_USER` | `admin` | Initial admin username (`demo` when [demo mode](#demo-mode) is on) |
| `ADMIN_PASS` | `changeme` | Initial admin password (`demo` when [demo mode](#demo-mode) is on) |
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
| `DEVICE_SESSION_IDLE_DAYS` | `90` | Days a mobile app sign-in stays valid without use. Each use extends it. |
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

## Online Payments (Stripe & PayPal)

Optional. Enables customers to pay invoices online from the public invoice link.
Configure either gateway or both; each is enabled per workspace under **Settings →
Payments** once its credentials (including the webhook secret/ID) are set. A
gateway without its webhook credential will not appear as an option, because
payments are confirmed server-side via webhooks.

### Stripe

| Variable | Default | Description |
|----------|---------|-------------|
| `STRIPE_SECRET_KEY` | — | Stripe secret key (`sk_...`) |
| `STRIPE_PUBLISHABLE_KEY` | — | Stripe publishable key (`pk_...`) |
| `STRIPE_WEBHOOK_SECRET` | — | Stripe webhook signing secret (`whsec_...`) — required |

### PayPal

| Variable | Default | Description |
|----------|---------|-------------|
| `PAYPAL_CLIENT_ID` | — | PayPal REST app client ID |
| `PAYPAL_SECRET` | — | PayPal REST app secret |
| `PAYPAL_WEBHOOK_ID` | — | PayPal webhook ID (for signature verification) — required |
| `PAYPAL_ENV` | `sandbox` | `sandbox` or `live` |

See [Online Payments](/features/payments) for setup instructions.

## Single Sign-On (OIDC)

Optional. Any standards-compliant OIDC provider (Keycloak, Authentik, Authelia, Entra ID,
Okta, Google Workspace, and others) can act as the sign-in source. Setting
`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` enables it; everything else
is discovered from `/.well-known/openid-configuration`.

| Variable | Default | Description |
|----------|---------|-------------|
| `OIDC_ISSUER_URL` | (none) | Issuer URL. Must be https. Setting it enables SSO |
| `OIDC_CLIENT_ID` | (none) | Confidential client ID |
| `OIDC_CLIENT_SECRET` | (none) | Confidential client secret |
| `OIDC_SCOPE` | `openid email profile` | Space-separated scopes (`openid` is always included) |
| `OIDC_ALLOWED_DOMAINS` | (none) | Comma-separated email domains allowed to self-register |
| `OIDC_AUTO_PROVISION` | `true` | Create a read-only Viewer account on first SSO login |
| `OIDC_PROVIDER_NAME` | (none) | Label for the SSO button on the login page |

1. Register a **confidential** client at your provider with the redirect URI
   `https://your-domain/api/v1/auth/oidc/callback` (use the origin your install is served
   from, or set `PUBLIC_BASE_URL`).
2. First-time logins get a read-only **Viewer** account unless `OIDC_AUTO_PROVISION=false`.
   Promote users under **Users**, and limit who can self-register with `OIDC_ALLOWED_DOMAINS`.
3. Existing accounts link on first SSO login only when the provider attests the email
   (`email_verified` claim). Password login stays available as the admin recovery path.

## PEPPOL

Optional. The `PEPPOL_SH_*` variables enable sending and receiving over the PEPPOL network.
See [PEPPOL Transport](/features/peppol-transport#environment-variables-oss-self-hosted).

## PDF Generation

Nothing to configure. Inkvoice renders invoices and quotes as HTML and the browser's print
dialog turns them into PDFs, so there is no Chrome or Chromium to install, bundle or point
at. The `CHROME_PATH` variable used by older versions is gone and is ignored if still set.

## Demo Mode

| Variable | Default | Description |
|----------|---------|-------------|
| `DEMO_MODE` | `false` | Enable demo mode with sample data and periodic resets |
| `DEMO_RESET_INTERVAL` | `86400000` | Reset interval in milliseconds (default 24 hours) |

With `DEMO_MODE=true` the admin defaults change from `admin` / `changeme` to
**`demo` / `demo`**, and the login page shows those credentials so visitors can
get in. Leave `ADMIN_USER` and `ADMIN_PASS` unset to pick up that default. The
repo's `docker-compose.yml` passes them through empty so the app decides, but
`.env.example` and the compose snippet in [Getting Started](./getting-started)
set them explicitly, so clear them if you copied either.

The login page only ever advertises the literal `demo` / `demo` pair. If you set
your own `ADMIN_PASS` alongside `DEMO_MODE=true`, no credentials are shown, so
enabling demo mode on an instance that holds real data can never publish its
password.
