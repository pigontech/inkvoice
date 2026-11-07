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
4. Set the issue date, due date, service date, and any notes or payment terms
5. Review the totals (subtotal, tax, discount, total)
6. **Save as Draft** to continue editing later, or **Publish** to make it available

## Service Date

The date of supply (Leistungsdatum), which German invoices must state (§ 14 Abs. 4 Nr. 6
UStG). Enter one date, or switch to **Use a period instead** for a service period. It is
printed on the invoice PDF and sent in e-invoices (BT-72 for a date, BG-14 for a period). A
credit note keeps the service date of the invoice it corrects; a duplicate starts without one.

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

## Early Payment Discount (Skonto)

An invoice can offer a discount for paying early:

- In the **totals** section of the invoice form, set a discount type (`%` or fixed amount), a discount value, and the number of days the offer is valid from the issue date.
- The PDF shows the savings and the deadline (e.g. `Early payment discount (due by 2026-01-15)`).
- When recording a payment inside the window, tick **Apply early-payment discount**; the amount is prefilled to the discounted balance and the invoice settles as paid.
- If the discount window has passed, the option is disabled. Deleting a payment that used the discount reverts the invoice to its unpaid state.

## Sharing

Published invoices get a unique share link that customers can use to:

- View the invoice in the browser
- Download the PDF
- Pay online (if Stripe or PayPal is configured)

## Batch Operations

Select multiple invoices to:

- Delete drafts in bulk
- Move to trash
- Restore from trash

## Consolidated Invoice

Merge several draft invoices for one customer into a single consolidated draft:

1. Open any draft invoice and choose **Consolidate** from the actions menu.
2. Pick the target customer (defaults to the current invoice's customer).
3. Select at least two draft invoices for that customer and confirm.

How it works:

- **Line items** from each source are copied in order into the new draft; the merged subtotal, tax, and total are the exact sum of the sources. Existing draft discounts are not carried over, but you can apply a single discount when consolidating via the API.
- **Source grouping** is preserved: the PDF and detail view group line items under their source invoice number, with a per-source subtotal row.
- **Constraints**: sources must be drafts, belong to the same customer, and share a currency (mixing currencies is rejected).
- The API route is `POST /api/v1/invoices/consolidate` with `{ customer_id, invoice_ids: string[], discount_type?, discount_value? }`; it returns the new consolidated draft.

## CSV Export

Export your invoice list as a CSV file from the Invoices page. The export includes invoice number, customer, dates, status, and totals.
