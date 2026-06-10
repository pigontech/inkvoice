# Customers API

## List Customers

```
GET /api/v1/customers
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Search by name, email, or phone |
| `page` | number | Page number |
| `limit` | number | Items per page |

## Create Customer

```
POST /api/v1/customers
```

**Request Body:**

```json
{
  "name": "Acme Corp",
  "email": "billing@acme.com",
  "phone": "+1-555-0123",
  "address_line1": "123 Business Ave",
  "address_line2": "Suite 456",
  "city": "San Francisco",
  "state": "CA",
  "postal_code": "94102",
  "country": "US",
  "tax_id": "US123456789",
  "notes": "Net 30 terms agreed"
}
```

## Get Customer

```
GET /api/v1/customers/:id
```

Returns customer details with invoice summary (total invoiced, total paid, outstanding).

## Update Customer

```
PUT /api/v1/customers/:id
```

## Delete Customer

```
DELETE /api/v1/customers/:id
```

Fails if the customer has existing invoices.

## Export CSV

```
GET /api/v1/customers/export/csv
```

## Batch Operations

```
POST /api/v1/customers/batch
```

## Account Statement

Generate a per-customer account statement (opening balance, invoices, payments,
credit notes, running + closing balance, and an aging summary) as print-ready
HTML — the same "print to PDF" model used for invoices. Amounts are consolidated
into the business base currency via each document's exchange rate.

```
GET /api/v1/customers/:id/statement?from=YYYY-MM-DD&to=YYYY-MM-DD
```

`from`/`to` are optional and default to year-to-date (`to` = today, `from` =
Jan 1 of that year). Returns `text/html`.

Email the statement to the customer (inline HTML, no attachment):

```
POST /api/v1/customers/:id/statement/send
```

**Request Body (all optional):**

```json
{
  "from": "2026-01-01",
  "to": "2026-06-30",
  "to_email": "override@example.com",
  "subject": "Your statement",
  "message": "Thanks for your business."
}
```

Recipient defaults to the customer's email. Requires SMTP to be configured.
