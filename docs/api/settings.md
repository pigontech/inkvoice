# Settings API

## Get All Settings

```
GET /api/v1/settings
```

Returns all business settings as key-value pairs.

## Update Settings

```
PUT /api/v1/settings
```

**Request Body:**

```json
{
  "business_name": "My Company",
  "business_email": "hello@mycompany.com",
  "business_phone": "+1-555-0100",
  "business_address": "123 Main St",
  "business_city": "New York",
  "business_state": "NY",
  "business_postal_code": "10001",
  "business_country": "US",
  "business_tax_id": "US987654321",
  "default_currency": "USD",
  "invoice_prefix": "INV-",
  "invoice_next_number": 1001,
  "default_payment_terms": "Net 30",
  "default_notes": "Thank you for your business"
}
```

## Upload Logo

```
POST /api/v1/settings/logo
```

Accepts a multipart form upload. The logo is used in invoice templates.

## Test Email

```
POST /api/v1/settings/test-email
```

Sends a test email to verify SMTP configuration.

**Request Body:**

```json
{
  "to": "test@example.com"
}
```
