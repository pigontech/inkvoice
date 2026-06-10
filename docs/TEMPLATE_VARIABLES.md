# Template Variables

The reference list of every `{{token}}` you can use in invoice / quote templates and email templates.

Inkvoice templates are rendered by [Mustache](https://mustache.github.io/), so the syntax is identical: `{{name}}` for plain output, `{{#section}}…{{/section}}` for loops/conditionals, `{{^section}}…{{/section}}` for the "empty" branch.

The actual context is built in `packages/backend/src/services/pdf.service.ts` (`buildInvoiceContext`, `buildQuoteContext`) and `packages/backend/src/services/email-templates.ts`. If a value isn't listed below, it isn't available — adding a new one means extending those builders and re-deploying.

---

## Invoice and quote templates

These tokens are available to anything rendered by `pdf.service.ts` (the PDF route, the in-app preview, the public share page). Quotes use the same context shape, so a single template can serve both.

### Document fields

| Token                  | Type            | Notes                                                                                       |
| ---------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| `{{invoice_number}}`   | string          | The document number. For quotes, this contains the `quote_number` so the same template renders both. |
| `{{issue_date}}`       | string          | Already locale-formatted (`Intl.DateTimeFormat` or `date_format` setting).                   |
| `{{due_date}}`         | string \| null  | Locale-formatted. Empty for quotes (use `{{#due_date}}…{{/due_date}}` to hide when absent).  |
| `{{status}}`           | string          | `draft`, `sent`, `paid`, `overdue`, `voided`, etc.                                          |
| `{{document_title}}`   | string          | `Quote` for quotes; absent for invoices (defaults handled in template).                     |
| `{{is_quote}}`         | boolean         | True only on quotes — handy for `{{#is_quote}}…{{/is_quote}}`.                              |
| `{{currency}}`         | string          | ISO 4217 code (`USD`, `EUR`, …).                                                            |
| `{{payment_terms}}`    | string \| null  | Free-form (e.g. `NET 30`).                                                                  |
| `{{notes}}`            | string \| null  | Free-form footer notes.                                                                     |

### Money totals

All `formatted_*` values are pre-formatted with the active locale, currency, and `number_format` setting — drop them in directly.

| Token                       | Type    | Notes                                                                  |
| --------------------------- | ------- | ---------------------------------------------------------------------- |
| `{{formatted_subtotal}}`    | string  | Sum of line totals before tax/discount.                                |
| `{{has_discount}}`          | boolean | Use to gate the discount row.                                          |
| `{{formatted_discount}}`    | string  | Pre-formatted discount amount.                                         |
| `{{#tax_summary}}`          | section | One entry per distinct tax rate. Inside: `{{name}}`, `{{rate}}`, `{{formatted_amount}}`. |
| `{{formatted_total}}`       | string  | Grand total.                                                           |

### Company (your business)

Pulled from the **Settings** page.

| Token                       | Notes                                          |
| --------------------------- | ---------------------------------------------- |
| `{{company.name}}`          |                                                |
| `{{company.email}}`         |                                                |
| `{{company.phone}}`         |                                                |
| `{{company.address}}`       | Newlines pre-converted to `<br>`.              |
| `{{company.tax_id}}`        |                                                |
| `{{company.logo}}`          | Data-URI; drop into `<img src="…">` directly. |
| `{{company.bank_details}}`  | Newlines pre-converted to `<br>`.              |

### Customer

| Token                            | Notes                                                              |
| -------------------------------- | ------------------------------------------------------------------ |
| `{{customer.name}}`              |                                                                    |
| `{{customer.email}}`             |                                                                    |
| `{{customer.phone}}`             |                                                                    |
| `{{customer.address_line1}}`     |                                                                    |
| `{{customer.address_line2}}`     |                                                                    |
| `{{customer.city}}`              |                                                                    |
| `{{customer.state}}`             |                                                                    |
| `{{customer.postal_code}}`       |                                                                    |
| `{{customer.country}}`           | ISO 3166-1 alpha-2 code (`US`, `TR`, …).                           |
| `{{customer.country_name}}`      | Full country name in the active locale (`United States`, `Türkiye`).|
| `{{customer.tax_id}}`            |                                                                    |

### Line items

```mustache
{{#items}}
  <tr>
    <td>{{description}}</td>
    <td>{{quantity}} {{unit}}</td>
    <td>{{formatted_unit_price}}</td>
    <td>{{tax_rate}}%</td>
    <td>{{formatted_line_total}}</td>
  </tr>
{{/items}}
```

| Token                          | Notes                                                |
| ------------------------------ | ---------------------------------------------------- |
| `{{description}}`              | Free text from the line item.                        |
| `{{quantity}}`                 | Number — format yourself if needed.                  |
| `{{unit}}`                     | `piece`, `hour`, `day`, etc.                         |
| `{{unit_price}}`               | Raw number.                                          |
| `{{formatted_unit_price}}`     | Pre-formatted with currency.                         |
| `{{tax_rate}}`                 | Number (e.g. `20` for 20%).                          |
| `{{line_total}}`               | Raw number.                                          |
| `{{formatted_line_total}}`     | Pre-formatted with currency.                         |

### Watermark (DRAFT / PAID / etc.)

Only present when `Watermark enabled` is on **and** an image is uploaded.

```mustache
{{#watermark}}
  <div class="watermark"><img src="{{image}}" alt="{{status}}"></div>
{{/watermark}}
```

| Token                | Notes                                            |
| -------------------- | ------------------------------------------------ |
| `{{watermark.image}}`  | Data-URI of the uploaded watermark.            |
| `{{watermark.status}}` | The current document status (`draft`, `paid`).|

### QR code

Only present when `pdf_qr_code_enabled` is on, the document is published (has a share token), and a `public_url` is configured.

```mustache
{{#qr}}
  <img src="{{image}}" alt="Scan to view">
  <div>{{url}}</div>
{{/qr}}
```

---

## Email templates (built-in)

Emails are rendered in `services/email-templates.ts`. They aren't user-editable yet — these are the variables the existing templates feed in. (A user-facing email template editor is on the backlog.)

### `invoiceDeliveryEmail` — sent when you click "Send" on an invoice

| Token                  | Notes                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| `company_name`         | From `email_from_name` setting, falls back to company name.          |
| `customer_name`        |                                                                      |
| `invoice_number`       |                                                                      |
| `total`                | Pre-formatted currency string.                                       |
| `currency`             |                                                                      |
| `due_date`             | Pre-formatted, may be `null`.                                        |
| `public_url`           | Public share link (only present if invoice is published).            |
| `custom_message`       | Optional message typed by the sender in the "Send invoice" dialog.   |

The footer pulls from the `email_footer_text` setting if set.

### `portalWelcomeEmail` — sent when you enable client-portal access on a customer

| Token            | Notes                                                                  |
| ---------------- | ---------------------------------------------------------------------- |
| `company_name`   |                                                                        |
| `customer_name`  |                                                                        |
| `portal_url`     | The customer's tokenized portal URL.                                   |

---

## Adding a new variable

1. Add the field to the relevant context builder (`buildInvoiceContext`, `buildQuoteContext`, or one of the email-template functions).
2. Update **this file** so template authors can find it.
3. If your new field needs locale-aware formatting, do it in the builder — never expect templates to do `Intl.*` themselves.
