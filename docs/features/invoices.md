# Invoices

Invoices are the core of Inkvoice. Each invoice goes through a lifecycle from draft to paid (or voided).

## Invoice Lifecycle

```
Draft → Sent → Paid
  ↓       ↓
Voided  Overdue → Paid
```

### Statuses

| Status | Description |
|--------|-------------|
| **Draft** | Invoice is being created or edited. Not visible to the customer. |
| **Sent** | Invoice has been published and optionally emailed to the customer. |
| **Paid** | Invoice has been fully paid. |
| **Overdue** | Past the due date and not yet paid. |
| **Voided** | Invoice has been cancelled. Cannot be edited or paid. |

## Creating an Invoice

1. Navigate to **Invoices** and click **New Invoice**
2. Select a customer (or create one inline)
3. Add line items — pick from your product catalog or enter custom descriptions
4. Set the issue date, due date, and any notes or payment terms
5. Review the totals (subtotal, tax, discount, total)
6. **Save as Draft** to continue editing later, or **Publish** to make it available

## Line Items

Each line item has:

- **Description** — What you're billing for
- **Quantity** — How many units
- **Unit Price** — Price per unit
- **Unit** — The unit type (piece, hour, day, kg, etc.)
- **Tax** — Tax rate applied to this line

Totals are calculated automatically: `line_total = quantity × unit_price + tax_amount`.

## Actions

| Action | Description |
|--------|-------------|
| **Publish** | Generates a share token and makes the invoice available via public link |
| **Send** | Emails the invoice to the customer (requires SMTP configuration) |
| **Mark as Sent** | Manually mark as sent without emailing |
| **Mark as Paid** | Record full payment |
| **Record Payment** | Record a partial payment |
| **Duplicate** | Create a new draft with the same line items and customer |
| **Credit Note** | Generate a credit note from the invoice |
| **Void** | Cancel the invoice |
| **Download PDF** | Generate and download a PDF |

## Sharing

Published invoices get a unique share link that customers can use to:

- View the invoice in the browser
- Download the PDF
- Pay online (if Stripe is configured)

## Batch Operations

Select multiple invoices to:

- Delete drafts in bulk
- Move to trash
- Restore from trash

## CSV Export

Export your invoice list as a CSV file from the Invoices page. The export includes invoice number, customer, dates, status, and totals.
