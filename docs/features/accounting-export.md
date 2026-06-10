# Accounting Export

Inkvoice can export your invoices, payments and expenses as CSV files formatted for import into **QuickBooks Online** or **Xero**. It's a one-way hand-off — Inkvoice does not sync data back — so you can keep invoicing in Inkvoice while your accountant books the figures in their ledger.

## How it works

Open **Reports → Accounting Export** and:

1. Choose a target format — **QuickBooks Online** or **Xero**.
2. Pick a date range. The presets respect your [fiscal-year start month](./reports) setting.
3. (Xero only) Optionally set the sales/expense account codes.
4. Download a CSV for each dataset you need: **Invoices**, **Payments**, **Expenses**.

## What's exported

- **Invoices** — finalized invoices (`sent`, `paid`, `partially paid`, `overdue`, `complete`), filtered by issue date, **one row per line item** grouped by invoice number. Drafts, voided invoices and credit notes are excluded.
- **Payments** — recorded payments, filtered by payment date, as a **bank-statement-style CSV** you import to a bank/clearing account and reconcile against the invoices.
- **Expenses** — expenses, filtered by expense date, mapped to **bills / purchases**.

## Conventions

- **Native amounts.** Figures are exported in each document's own currency, with a `Currency` column. QuickBooks/Xero perform any currency conversion on their side — there is no base-currency consolidation here.
- **ISO dates.** Dates are `YYYY-MM-DD`. If your accounting organization expects a different date format, adjust it during import.

## Xero account codes & tax types

Xero's invoice/bill import requires an **Account Code** and **Tax Type** on every line, which Inkvoice can't know from your chart of accounts. The export fills them with safe defaults you should review:

- **Account Code** — taken from the export panel (default `200` for sales, `400` for expenses). Change these to match your Xero accounts.
- **Tax Type** — `Tax Exempt` for zero-rate lines, otherwise `Tax on Sales` / `Tax on Purchases`. The actual tax value is always in the `TaxAmount` column. Adjust the tax type to match your org's configured rates if needed.

## Column mappings

### Invoices → Xero (Sales Invoices)

| Xero column | Inkvoice field |
|---|---|
| ContactName | Customer name |
| EmailAddress | Customer email |
| POAddressLine1 / POCity / PORegion / POPostalCode / POCountry | Customer address |
| InvoiceNumber | Invoice number |
| Reference | Invoice notes |
| InvoiceDate | Issue date |
| DueDate | Due date |
| Description | Line item description |
| Quantity | Line quantity |
| UnitAmount | Line unit price |
| AccountCode | Sales account code (default `200`) |
| TaxType | Derived from the line tax rate |
| TaxAmount | Line tax amount |
| Currency | Invoice currency |

### Invoices → QuickBooks Online (Invoices)

| QuickBooks column | Inkvoice field |
|---|---|
| InvoiceNo | Invoice number |
| Customer | Customer name |
| InvoiceDate | Issue date |
| DueDate | Due date |
| Item(Product/Service) | Blank — map a default product/service on import |
| ItemDescription | Line item description |
| ItemQuantity | Line quantity |
| ItemRate | Line unit price |
| ItemAmount | Line total |
| Currency | Invoice currency |
| Taxable | `Y`/`N` from the line tax rate |
| TaxRate | Line tax rate |

### Payments → Xero (Bank Statement)

| Xero column | Inkvoice field |
|---|---|
| Date | Payment date |
| Amount | Payment amount |
| Payee | Customer name |
| Description | `Invoice <number>` |
| Reference | Payment reference (falls back to invoice number) |

### Payments → QuickBooks Online (Bank Transactions)

| QuickBooks column | Inkvoice field |
|---|---|
| Date | Payment date |
| Description | `<Customer> - Invoice <number> (reference)` |
| Amount | Payment amount |

### Expenses → Xero (Bills / Purchases)

| Xero column | Inkvoice field |
|---|---|
| ContactName | Vendor |
| InvoiceNumber | Receipt reference |
| InvoiceDate / DueDate | Expense date |
| Description | Expense description |
| Quantity | `1` |
| UnitAmount | Expense amount (pre-tax) |
| AccountCode | Expense account code (default `400`) |
| TaxType | Derived from the tax rate |
| TaxAmount | Expense tax amount |
| Currency | Expense currency |

### Expenses → QuickBooks Online (Bills)

| QuickBooks column | Inkvoice field |
|---|---|
| BillNo | Receipt reference |
| Supplier | Vendor |
| BillDate / DueDate | Expense date |
| Account | Expense category |
| LineDescription | Expense description |
| LineAmount | Expense total |
| Currency | Expense currency |

## Importing the files

- **QuickBooks Online:** Settings (gear) → *Import data* → *Invoices*, *Bills*, or *Bank transactions*.
- **Xero:** *Business → Invoices / Bills → Import* for invoices and bills; *Accounting → Bank accounts → Import a Statement* for payments.

Because account and tax mapping vary by organization, review the imported data in QuickBooks/Xero before finalizing.
