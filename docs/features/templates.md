# Invoice Templates

Customize the appearance of your invoice PDFs and public invoice pages with Mustache HTML templates.

## Built-in Templates

Inkvoice ships with built-in templates that cover common invoice layouts. You can use them as-is or as a starting point for customization.

## Custom Templates

### Creating a Template

1. Navigate to **Templates** and click **New Template**
2. Write your HTML template using Mustache syntax
3. Add CSS for styling
4. Preview with sample data
5. Save

### Template Variables

Templates receive the full invoice data as Mustache variables:

| Variable | Description |
|----------|-------------|
| `invoice_number` | Invoice number |
| `issue_date` | Issue date |
| `due_date` | Due date |
| `status` | Invoice status |
| `subtotal` | Subtotal before tax and discount |
| `tax_total` | Total tax amount |
| `discount_amount` | Discount amount |
| `total` | Final total |
| `notes` | Invoice notes |
| `payment_terms` | Payment terms |
| `currency` | Currency code |
| `items` | Array of line items (use Mustache section syntax to loop) |
| `items[].description` | Line item description |
| `items[].quantity` | Line item quantity |
| `items[].unit_price` | Line item unit price |
| `items[].line_total` | Line item total |
| `customer.name` | Customer name |
| `customer.email` | Customer email |
| `customer.address_line1` | Customer address |
| `business.name` | Your business name |
| `business.email` | Your business email |
| `business.address` | Your business address |
| `business.logo_url` | Your business logo URL |

### Installing Templates

You can install templates from a URL or upload a template file. Templates can also be updated from their remote source.

### Default Template

Set any template as the default. New invoices will use the default template unless you select a different one.
