# Recurring Invoices

Automate invoice generation for subscription billing, retainers, or any regular billing cycle.

## Creating a Recurring Invoice

1. Navigate to **Recurring Invoices** and click **New**
2. Select a customer and add line items (same as a regular invoice)
3. Set the schedule:
   - **Frequency** — How often to generate (weekly, monthly, quarterly, yearly)
   - **Start Date** — When the first invoice should be created
   - **End Date** — Optional end date to stop generation
4. Save

## How It Works

A background scheduler checks for due recurring invoices and automatically creates new draft invoices based on the template. Generated invoices are regular invoices — you can review, edit, and publish them like any other.

## Managing Recurring Invoices

| Action | Description |
|--------|-------------|
| **Pause** | Temporarily stop generating invoices |
| **Resume** | Resume a paused recurring invoice |
| **Generate Now** | Immediately create the next invoice regardless of schedule |
| **Edit** | Update line items, customer, or schedule for future invoices |
| **Delete** | Remove the recurring template (existing generated invoices are not affected) |
