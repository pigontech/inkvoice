# Recurring Invoices

Automate invoice generation for subscription billing, retainers, or any regular billing cycle.

## Creating a Recurring Invoice

1. Navigate to **Recurring Invoices** and click **New**
2. Select a customer and add line items (same as a regular invoice)
3. Set the schedule:
   - **Frequency** — How often to generate (weekly, monthly, quarterly, yearly)
   - **Start Date** — When the first invoice should be created
   - **End Date** — Optional end date to stop generation
4. Optionally turn on:
   - **Auto-send**: email the generated invoice to the customer as soon as it is created, instead of leaving it a draft for you to review first.
   - **Auto-bill**: charge the customer's saved card automatically when the invoice is generated. This is disabled in the form until the customer has a saved card (a card is saved from a "save this card" checkbox they see at checkout, see Online Payments). If the charge fails, the customer is emailed a payment link instead of being billed silently.
5. Save

## How It Works

A background scheduler checks for due recurring invoices and automatically creates new invoices based on the template.

A profile left at its defaults (both Auto-send and Auto-bill off) only ever produces a draft, exactly as before. You review, edit, and publish it like any other invoice, nothing is sent or charged without you taking an action.

Turning on either toggle finalises the generated invoice right away (it is numbered, marked sent, and gets a shareable link), then:

- With **Auto-bill** on, Inkvoice attempts to charge the customer's default saved card for the full balance. A successful charge marks the invoice paid. A failed charge (declined, requires authentication, or no usable saved card) leaves the invoice as sent and emails the customer a payment link so they can pay by hand. See Online Payments for the retry schedule that applies to a temporary decline.
- With **Auto-send** on, the invoice is emailed to the customer as a normal delivery, unless Auto-bill already emailed a payment link for the same invoice on a failed charge. That way the customer is never emailed twice for the same event.

## Managing Recurring Invoices

| Action | Description |
|--------|-------------|
| **Pause** | Temporarily stop generating invoices |
| **Resume** | Resume a paused recurring invoice |
| **Generate Now** | Immediately create the next invoice regardless of schedule |
| **Edit** | Update line items, customer, or schedule for future invoices |
| **Delete** | Remove the recurring template (existing generated invoices are not affected) |
