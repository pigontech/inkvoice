# Introduction

Inkvoice is an open-source, self-hosted invoicing dashboard designed for freelancers, small businesses, and anyone who wants full control over their billing workflow.

## Why Inkvoice?

Most invoicing tools are either SaaS platforms that charge per invoice or self-hosted solutions that require 500MB+ of RAM. Inkvoice takes a different approach:

- **50-100MB RAM** — Built on Bun with Hono (14KB) and SQLite (zero-copy native bindings)
- **Single container** — No separate database server, no reverse proxy, no multi-service orchestration
- **Modern stack** — React 19, Tailwind CSS, shadcn/ui — a clean UI without the bloat
- **Full featured** — Invoices, quotes, recurring billing, PDF generation, Stripe payments, reports

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Backend | Hono v4 |
| Database | SQLite (bun:sqlite) |
| Frontend | React 19 + Vite 6 |
| Styling | Tailwind CSS v4 + shadcn/ui |
| PDF | Puppeteer + Chrome Headless |
| Templates | Mustache |

## How It Works

Inkvoice is a monorepo with two packages:

- **`packages/backend`** — Hono API server that handles all business logic, authentication, and serves the built frontend as static files
- **`packages/frontend`** — React SPA that communicates with the backend via a typed API client

In production, Bun runs the Hono server which serves the API at `/api/*` and the pre-built React app for everything else. One process, one port, one container.
