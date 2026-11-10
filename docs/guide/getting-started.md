# Getting Started

## Docker (Recommended)

The fastest way to run Inkvoice is with Docker Compose.

### 1. Generate a signing secret

```bash
openssl rand -base64 48
```

Inkvoice refuses to start in production without `JWT_SECRET`, and it must be at
least 32 characters. Keep the output for the next step.

### 2. Create a `docker-compose.yml`

```yaml
services:
  app:
    image: ghcr.io/pigontech/inkvoice:latest
    ports:
      - "3000:3000"
    volumes:
      - invoice-data:/app/data
    environment:
      ADMIN_USER: admin
      ADMIN_PASS: pick-a-strong-password
      JWT_SECRET: paste-the-openssl-output-here
      # Serving over plain HTTP? Keep this false. It defaults to true, which
      # marks the session cookie Secure, and browsers then drop it on any
      # non-HTTPS address other than localhost, so logins silently fail.
      COOKIE_SECURE: "false"
    restart: unless-stopped
    # Bun sizes its heap to the memory it can see, so keep this cap.
    mem_limit: 512m

volumes:
  invoice-data:
```

### 3. Start it

```bash
docker compose up -d
```

### 4. Open the app

Navigate to [http://localhost:3000](http://localhost:3000) and log in with the credentials you set above.

::: tip
Putting this on the public internet? Terminate TLS in front of it, then switch to
`COOKIE_SECURE: "true"` and add `ENABLE_HSTS: "true"`.
:::

The `latest` tag tracks `main`. For a stable deployment, pin a release tag such as
`ghcr.io/pigontech/inkvoice:0.3.7`.

## Manual Setup

If you prefer to run Inkvoice without Docker:

### Prerequisites

- [Bun](https://bun.sh) (latest stable)

### 1. Clone the repository

```bash
git clone https://github.com/pigontech/inkvoice.git
cd inkvoice
```

### 2. Install dependencies

```bash
bun install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your settings. See [Configuration](./configuration) for all options.

### 4. Start the development server

```bash
# Start both backend and frontend
bun run dev

# Or start them separately
bun run dev:backend   # API on port 3000
bun run dev:frontend  # Vite dev server on port 5173
```

### 5. Build for production

```bash
bun run build
bun run start
```

This builds the frontend to static files and starts the Hono server on port 3000.
