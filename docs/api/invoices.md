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
  "currency": "USD",
  "notes": "Thank you for your business",
  "payment_terms": "Net 30",
  "discount_type": "percentage",
  "discount_value": 10,
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

## Delete Invoice

```
DELETE /api/v1/invoices/:id
```

Only draft invoices can be deleted.

## Publish

```
POST /api/v1/invoices/:id/publish
```

Publishes the invoice and generates a share token. Changes status from `draft` to `sent`.

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
