# Authentication

## Login

```
POST /api/v1/auth/login
```

Authenticate and receive a JWT token.

**Request Body:**

```json
{
  "username": "admin",
  "password": "your-password"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "token": "eyJhbG...",
    "user": {
      "id": "abc123",
      "username": "admin",
      "email": "admin@example.com",
      "display_name": "Admin",
      "is_admin": true
    }
  }
}
```

The token is also set as an HTTP-only cookie.

## Logout

```
POST /api/v1/auth/logout
```

Clears the authentication cookie.

## Current User

```
GET /api/v1/auth/me
```

Returns the currently authenticated user's profile.

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "abc123",
    "username": "admin",
    "email": "admin@example.com",
    "display_name": "Admin",
    "is_admin": true,
    "permissions": [
      { "resource": "invoices", "action": "read" },
      { "resource": "invoices", "action": "create" }
    ]
  }
}
```

## API Tokens (for integrations)

For scripts and automation tools (Zapier, Make, cron jobs) that can't run an
interactive login, use a long-lived **API token** instead of a session JWT.
Generate one under **Settings → API**, then send it as a bearer token:

```
Authorization: Bearer ink_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

API tokens:

- are shown **once** at creation — store them securely;
- can be **scoped** to specific resources/actions, or granted full access;
- never expire on a clock — revoke them to cut access;
- authenticate as the user who created them.

See [Integrations](/api/integrations) for the full token and polling workflow.

## Rate Limiting

The login endpoint is rate-limited by default. After `RATE_LIMIT_MAX_ATTEMPTS` failed attempts within `RATE_LIMIT_WINDOW` seconds, further attempts are blocked.
