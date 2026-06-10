# Getting Started

## Docker (Recommended)

The fastest way to run Inkvoice is with Docker Compose.

### 1. Create a `docker-compose.yml`

```yaml
services:
  app:
    image: ghcr.io/pigontech/inkvoice:latest
    ports:
      - "3000:3000"
    volumes:
      - invoice-data:/app/data
    environment:
      - ADMIN_USER=admin
      - ADMIN_PASS=changeme
      - JWT_SECRET=change-this-to-a-random-string-at-least-32-chars
    restart: unless-stopped

volumes:
  invoice-data:
```

### 2. Start it

```bash
docker compose up -d
```

### 3. Open the app

Navigate to [http://localhost:3000](http://localhost:3000) and log in with the credentials you set above.

::: tip
Change the default `ADMIN_PASS` and `JWT_SECRET` before exposing the app to the internet.
:::

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
