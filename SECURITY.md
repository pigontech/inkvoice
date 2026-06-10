# Security Policy

Inkvoice handles invoices, customer records and payment-gateway credentials, so we take
security reports seriously and appreciate responsible disclosure.

## Supported versions

Security fixes land on `main` and ship in the next release and the
`ghcr.io/pigontech/inkvoice:latest` Docker image. Only the latest release is supported —
please keep your deployment up to date.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub's vulnerability reporting:
**[Security tab → Report a vulnerability](https://github.com/pigontech/inkvoice/security/advisories/new)**

Include what you can:

- A description of the issue and its impact
- Steps to reproduce (a minimal proof of concept helps a lot)
- Affected version / commit and deployment setup (Docker, bare Bun, reverse proxy, …)

You can expect an acknowledgement within 72 hours and a status update as we triage.
We'll credit you in the fix's release notes unless you prefer to stay anonymous.

## Hardening your deployment

A few self-hosting reminders that prevent the most common issues:

- Set a strong, unique `JWT_SECRET` (min 32 chars) — never run with an example value
- Change `ADMIN_PASS` immediately after first login
- Run behind HTTPS and keep `COOKIE_SECURE=true`
- Keep `RATE_LIMIT_ENABLED=true` on internet-facing deployments
- Back up your `data/` directory — see `scripts/backup.sh`
