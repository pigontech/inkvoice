# Quotes API

## List Quotes

```
GET /api/v1/quotes
```

Supports the same filtering and pagination as invoices.

## Create Quote

```
POST /api/v1/quotes
```

**Request Body:**

```json
{
  "customer_id": "customer-uuid",
  "issue_date": "2026-01-15",
  "valid_until": "2026-02-15",
  "currency": "USD",
  "notes": "This quote is valid for 30 days",
  "items": [
    {
      "description": "Website Redesign",
      "quantity": 1,
      "unit_price": 5000,
      "unit": "lump_sum"
    }
  ]
}
```

## Get Quote

```
GET /api/v1/quotes/:id
```

## Update Quote

```
PUT /api/v1/quotes/:id
```

## Delete Quote

```
DELETE /api/v1/quotes/:id
```

## Publish

```
POST /api/v1/quotes/:id/publish
```

## Send by Email

```
POST /api/v1/quotes/:id/send
```

## Accept

```
POST /api/v1/quotes/:id/accept
```

## Reject

```
POST /api/v1/quotes/:id/reject
```

## Duplicate

```
POST /api/v1/quotes/:id/duplicate
```

## Convert to Invoice

```
POST /api/v1/quotes/:id/convert
```

Creates a new draft invoice from the accepted quote.

## Next Quote Number

```
GET /api/v1/quotes/next-number
```
