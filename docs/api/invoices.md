# Invoices API

## List Invoices

```
GET /api/v1/invoices
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status (`draft`, `sent`, `paid`, `overdue`, `voided`) |
| `customer_id` | string | Filter by customer |
| `from_date` | string | Filter by issue date (ISO 8601) |
| `to_date` | string | Filter by issue date (ISO 8601) |
| `search` | string | Search in invoice number and customer name |
| `page` | number | Page number |
| `limit` | number | Items per page |

## Create Invoice

```
POST /api/v1/invoices
```

**Request Body:**

```json
{
  "customer_id": "customer-uuid",
  "issue_date": "2026-01-15",
  "due_date": "2026-02-15",
  "service_period_start": "2026-01-01",
  "service_period_end": "2026-01-31",
  "currency": "USD",
  "notes": "Thank you for your business",
  "payment_terms": "Net 30",
  "discount_type": "percentage",
  "discount_value": 10,
  "cash_discount_type": "percentage",
  "cash_discount_value": 2,
  "cash_discount_days": 14,
  "template_id": "template-uuid",
  "items": [
    {
      "product_id": "product-uuid",
      "description": "Web Development",
      "quantity": 40,
      "unit_price": 150,
      "unit": "hour",
      "tax_id": "tax-uuid"
    }
  ]
}
```

## Get Invoice

```
GET /api/v1/invoices/:id
```

Returns the invoice with all line items, customer details, and payment history.

## Update Invoice

```
PUT /api/v1/invoices/:id
```

Same body as create. Only draft invoices can be edited.

The cash-discount fields (`cash_discount_type`, `cash_discount_value`,
`cash_discount_days`) are optional on update: a field left out of the body
keeps its stored value, and `null` clears it.

The service date (date of supply) is `service_date`, or a period from
`service_period_start` to `service_period_end` (ISO dates; a period needs both
and may not end before it starts). On update the three are replaced together:
a body without any of them keeps the stored values, and a body with any of them
sets all three, so a missing one becomes `null`.

## Delete Invoice

```
DELETE /api/v1/invoices/:id
```

Only draft invoices can be deleted.

## Publish

```
POST /api/v1/invoices/:id/publish
```

Publishes the invoice and generates a share token for the public link
(`/api/v1/public/invoices/:shareToken`). Allowed for `sent`, `partially_paid`,
`paid`, `overdue` and `complete` invoices; drafts and voided invoices cannot be
published. A partly paid invoice's public page shows the payments received and
the remaining balance, and online payment charges only that balance. Servers
that support partly paid share links report `features.partial_share_links: true`
in `GET /api/v1/public/config`.

## Unpublish

```
POST /api/v1/invoices/:id/unpublish
```

Revokes the share token and returns the invoice to `draft` status.

## Void

```
POST /api/v1/invoices/:id/void
```

Voids the invoice. Cannot be undone.

## Mark as Paid

```
POST /api/v1/invoices/:id/mark-paid
```

Marks the invoice as fully paid.

## Mark as Sent

```
POST /api/v1/invoices/:id/mark-sent
```

Marks a draft invoice as sent without emailing.

## Send by Email

```
POST /api/v1/invoices/:id/send
```

Sends the invoice to the customer via email. Requires SMTP configuration.

## Duplicate

```
POST /api/v1/invoices/:id/duplicate
```

Creates a new draft invoice with the same customer and line items.

## Credit Note

```
POST /api/v1/invoices/:id/credit-note
```

Generates a credit note from the invoice.

## Record Payment

```
POST /api/v1/invoices/:id/payments
```

**Request Body:**

```json
{
  "amount": 500.00,
  "method": "bank_transfer",
  "reference": "TXN-12345",
  "date": "2026-01-20"
}
```

## List Payments

```
GET /api/v1/invoices/:id/payments
```

## Delete Payment

```
DELETE /api/v1/invoices/:id/payments/:paymentId
```

## Next Invoice Number

```
GET /api/v1/invoices/next-number
```

Returns the next sequential invoice number based on your numbering pattern.

## Export CSV

```
GET /api/v1/invoices/export/csv
```

## Batch Operations

```
POST /api/v1/invoices/batch
```

**Request Body:**

```json
{
  "action": "delete",
  "ids": ["uuid-1", "uuid-2"]
}
```

## Trash

```
GET /api/v1/invoices/trash/list
POST /api/v1/invoices/trash/batch
```
