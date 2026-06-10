# API Reference

Inkvoice exposes a REST API at `/api/v1/`. All endpoints return JSON.

## Base URL

```
https://your-domain.com/api/v1
```

## Authentication

Most endpoints require a valid JWT token. Obtain one via the [login endpoint](/api/authentication).

Include the token as a cookie (set automatically by the login response) or as a Bearer token:

```
Authorization: Bearer <token>
```

## Response Format

All responses follow a consistent format:

### Success

```json
{
  "success": true,
  "data": { ... }
}
```

### Error

```json
{
  "success": false,
  "error": "Description of what went wrong"
}
```

### Paginated Lists

```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 142
  }
}
```

## Common Query Parameters

| Parameter | Description |
|-----------|-------------|
| `page` | Page number (default: 1) |
| `limit` | Items per page (default: 20) |
| `search` | Search term (applies to name, email, etc.) |
| `sort` | Sort field |
| `order` | Sort direction (`asc` or `desc`) |

## Endpoints

| Section | Base Path |
|---------|-----------|
| [Authentication](/api/authentication) | `/api/v1/auth` |
| [Invoices](/api/invoices) | `/api/v1/invoices` |
| [Quotes](/api/quotes) | `/api/v1/quotes` |
| [Customers](/api/customers) | `/api/v1/customers` |
| [Products](/api/products) | `/api/v1/products` |
| [Templates](/api/templates) | `/api/v1/templates` |
| [Settings](/api/settings) | `/api/v1/settings` |
| [Reports](/api/reports) | `/api/v1/reports` |

## Public Endpoints

These endpoints do not require authentication:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/public/invoices/:shareToken` | View shared invoice |
| `POST` | `/api/v1/public/invoices/:shareToken/pay` | Initiate Stripe payment |
| `GET` | `/api/v1/public/invoices/:shareToken/preview` | Invoice PDF preview |
| `GET` | `/api/v1/public/quotes/:shareToken` | View shared quote |
| `GET` | `/api/v1/public/quotes/:shareToken/preview` | Quote PDF preview |
| `GET` | `/health` | Health check |
