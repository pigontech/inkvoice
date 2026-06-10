# Deployment

Inkvoice ships as a single Docker container that serves both the API and the frontend. It works with any platform that supports Docker.

## Dokploy

1. Create a new project in Dokploy
2. Add a new **Application** with source type **GitHub**
3. Point it to your Inkvoice repository
4. Set the build path to `/` (root) — the `Dockerfile` is at the root of the repo
5. Add environment variables:
   - `ADMIN_USER` — your admin username
   - `ADMIN_PASS` — a strong password
   - `JWT_SECRET` — a random string (32+ characters)
6. Add a persistent volume: mount `/app/data` to preserve the database
7. Deploy

::: tip
Generate a random JWT secret:
```bash
openssl rand -base64 48
```
:::

## Coolify

1. Create a new resource and select **Docker Compose** or **Dockerfile**
2. Connect your GitHub repository
3. Set the environment variables (same as above)
4. Add a persistent storage volume mapped to `/app/data`
5. Deploy

## Plain Docker

```bash
docker run -d \
  --name inkvoice \
  -p 3000:3000 \
  -v inkvoice-data:/app/data \
  -e ADMIN_USER=admin \
  -e ADMIN_PASS=your-strong-password \
  -e JWT_SECRET=your-random-secret-at-least-32-chars \
  ghcr.io/pigontech/inkvoice:latest
```

## Reverse Proxy

Inkvoice runs on a single port (default 3000). Place it behind your preferred reverse proxy for SSL termination.

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name invoices.example.com;

    ssl_certificate /etc/ssl/certs/your-cert.pem;
    ssl_certificate_key /etc/ssl/private/your-key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Caddy

```
invoices.example.com {
    reverse_proxy localhost:3000
}
```

## Backups

The entire application state lives in a single SQLite file at `DATABASE_PATH` (default: `/app/data/invoice.db`). To back it up:

```bash
# Copy from a running container
docker cp inkvoice:/app/data/invoice.db ./backup-$(date +%F).db

# Or if using a named volume
docker run --rm -v inkvoice-data:/data -v $(pwd):/backup \
  alpine cp /data/invoice.db /backup/backup-$(date +%F).db
```

Schedule this with cron for automated backups. SQLite supports safe reads while the app is running.

## Updating

```bash
docker compose pull
docker compose up -d
```

Database migrations run automatically on startup.
