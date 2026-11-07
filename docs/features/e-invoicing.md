# E-Invoicing (E-Rechnung)

German e-invoicing support: emit XRechnung and ZUGFeRD e-invoices, deliver them by email, and
receive incoming e-invoices from suppliers. The output is checked in CI with the official KoSIT
validator and Mustang (see [Conformance](#conformance)). In Germany, receiving e-invoices has been mandatory
for all businesses since **1 January 2025**; sending becomes mandatory in **2027** (businesses
above €800k) and **2028** (all businesses).

## Opt-in module

E-Rechnung is **disabled by default** and invisible unless you turn it on — non-German users
never see the E-Rechnung UI. Enable it under **Settings → E-Rechnung (e-invoice)**:

- Shows the **E-Rechnung panel** on every invoice detail view
- Adds the **E-Rechnungen** inbox to the sidebar (`/einvoices`)
- Shows the **E-Rechnung section** in the customer form
- Enables auto-attaching the e-invoice to sent invoice emails
- The setting applies immediately after saving, no restart needed

## Formats

| Format | When it is used | Output |
|---|---|---|
| **ZUGFeRD / Factur-X**, profile **EN 16931** | Default (`zugferd`) | CII XML (`factur-x.xml`) embedded in a **PDF/A-3b hybrid PDF** |
| **XRechnung 3.0** (UBL) | Customer has a **Leitweg-ID**, or format set to `xrechnung` | UBL 2.1 XML (no hybrid PDF) |
| **PEPPOL BIS 3.0** | Customer or business format set to `peppol` | UBL XML (not covered by the conformance check) |

Resolution order per invoice: **customer format → business setting → ZUGFeRD**; a customer
Leitweg-ID always forces XRechnung.

## Company requirements

With the module on, **Settings → General → E-Rechnung** asks for what e-invoices need on top of
your business profile:

- **Street, postcode, city and country** as separate fields (the free-text address is only used
  on printed invoices)
- **Steuernummer**, needed if you have no **USt-IdNr.** (`DE` + 9 digits, under Settings →
  Business)
- **Default format** (ZUGFeRD or XRechnung) and the **Kleinunternehmer (§ 19 UStG)** switch:
  a Kleinunternehmer's 0 % lines are emitted as VAT category `E` with the exemption reason
  "Kleinunternehmer gemäß § 19 UStG" and the § 19 note

From **Settings → Business**: company name, email, phone and **IBAN/BIC** (payment
instructions in the e-invoice). XRechnung also requires a phone number and an email address.

**VAT categories.** With the module on, the tax rate dialog (Settings → Tax) has an EN 16931
VAT category: `S` for 19 % and 7 %, `Z` zero rated, `E` exempt, `AE` reverse charge (§ 13b
UStG), `K` intra-EU supply, `G` export, `O` not subject to VAT. Exempt and reverse-charge
breakdowns carry the exemption reason the standard requires. An invoice with `O` lines leaves
out the VAT IDs (the Steuernummer identifies the seller) and can't mix `O` with other categories.
`K` is not supported yet: EN 16931 needs a delivery date and a delivery country for it, which
Inkvoice can't record, so the panel flags such an invoice.

Missing or malformed fields do not block emission (sending over PEPPOL does block on errors);
they are listed as errors and warnings in the e-invoice panel after **Create**. The send dialog
lists the errors before an email goes out, so you can fix them or send without the e-invoice.
Scheduled emails (recurring invoices, auto-bill) leave out an e-invoice with errors and log a
warning.

## Customer e-invoice fields

In the customer form (visible when the module is enabled):

| Field | Purpose |
|---|---|
| **E-invoice format** | Overrides the business default for this customer |
| **Tax number (Steuernummer)** | Kept for your records; EN 16931 has no field for the buyer's tax number. The e-invoice carries the customer's **USt-IdNr.** |
| **Leitweg-ID** | Official ID for public-sector (B2G) customers — forces XRechnung |
| **Receiver ID / scheme** | Identifier for XRechnung/PEPPOL delivery, e.g. `DE:VAT`, `0204` |

## Emitting an e-invoice

1. Mark the invoice as sent (or send it): a draft has a placeholder number, so the panel waits
   until the invoice has its final number.
2. Open the invoice → **E-invoices (E-Rechnung)** panel → **Create**.
3. The invoice is checked against the EN 16931 rules (and the XRechnung rules for XRechnung);
   the XML (and hybrid PDF for ZUGFeRD) is generated and stored as an immutable revision.
4. Download the XML or hybrid PDF from the panel.

What the output contains:

- **Credit notes** (type 381) carry positive amounts and refer to the corrected invoice
  (BT-25).
- A **document discount** is split per VAT rate and lowers each rate's taxable amount.
- **Buyer reference** (BT-10, mandatory in XRechnung): the customer's Leitweg-ID, otherwise the
  invoice number.
- **Electronic addresses** (BT-34/BT-49): your PEPPOL ID or email, the customer's Leitweg-ID,
  receiver ID or email.
- There is no service-date field yet, so no delivery date (BT-72) is sent. Put the service
  date or period in the invoice notes if it differs from the invoice date.

### Via API

```http
POST /api/v1/invoices/:id/einvoice/emit
GET  /api/v1/invoices/:id/einvoices
GET  /api/v1/invoices/:id/einvoices/:recordId/xml
GET  /api/v1/invoices/:id/einvoices/:recordId/pdf
DELETE /api/v1/invoices/:id/einvoices/:recordId
```

## Sending by email

When the module is enabled, **Send** on an invoice emits the e-invoice and attaches it to the
email automatically: a **ZUGFeRD hybrid PDF** for `zugferd`, the **raw XML** for XRechnung.
Per-email control lives in the send dialog (Advanced → "Attach e-invoice"), and the global
switch is the module toggle itself.

## Inbox (receiving)

The **E-Rechnungen** page (`/einvoices`) is a mailbox for incoming e-invoices:

- **Import** — upload XRechnung (UBL) or ZUGFeRD (CII) XML files; duplicates (sha256) are rejected
- **Parse** — supplier, document number, issue date and total are extracted automatically
- **Link** — optionally link a document to a customer in your address book
- **Status** — move documents through *inbox → processed → archived*
- **Raw download** — keep the original file for tax archives (8 years, §147 AO)

### Via API

```http
GET    /api/v1/einvoices/inbox
POST   /api/v1/einvoices/inbox/import          (multipart, max 20 MB)
GET    /api/v1/einvoices/inbox/:id
GET    /api/v1/einvoices/inbox/:id/raw
POST   /api/v1/einvoices/inbox/:id/link        ({ customer_id })
POST   /api/v1/einvoices/inbox/:id/status      ({ status: inbox|processed|archived })
DELETE /api/v1/einvoices/inbox/:id
```

## Conformance

`.github/workflows/einvoice-conformance.yml` generates a set of German sample invoices with
`scripts/einvoice-samples.ts` (19 %, 19 % + 7 %, discount, reverse charge, credit note,
Kleinunternehmer, Leitweg-ID, zero rated, exempt, export, not subject to VAT) and checks them
with:

- the **KoSIT validator** with the **XRechnung 3.0.2 configuration**: XRechnung (UBL) and the
  ZUGFeRD XML (EN 16931, CII);
- **Mustang**: the ZUGFeRD hybrid PDF (PDF/A-3 via veraPDF, embedded XML, profile).

To run the same check locally (Java 11+), download the versions pinned in the workflow, then:

```bash
bun run scripts/einvoice-samples.ts samples
java -jar validator-standalone.jar -s xrechnung/scenarios.xml -r xrechnung -o reports samples/*.xml
java -jar Mustang-CLI.jar --action validate --source samples/01-zugferd-19.pdf
```

## Storage & retention

- Emitted revisions are stored in `einvoice_documents` (XML + optional PDF + sha256 hash).
- Incoming files are stored in `einvoice_inbox` with their original bytes.
- Deleting an emitted revision is possible but **not recommended** — e-invoices must be kept
  for tax purposes for 8 years (§147 AO).
