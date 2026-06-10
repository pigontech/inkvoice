// Self-contained Mustache template for a customer account statement, rendered
// to print-ready HTML (the same "PDF = browser print" model the invoice
// templates use). Kept as an in-code template rather than a DB `templates` row
// so it never appears in the invoice template picker.
export const STATEMENT_TEMPLATE = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Statement — {{customer.name}}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; font-size: 13px; line-height: 1.45; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; }
  .company-name { font-size: 18px; font-weight: 700; }
  .muted { color: #666; }
  .logo { max-height: 56px; max-width: 180px; }
  h1 { font-size: 22px; letter-spacing: 0.02em; margin: 0 0 4px; }
  .meta { text-align: right; }
  .parties { display: flex; justify-content: space-between; gap: 24px; margin: 8px 0 24px; }
  .party-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  .txns th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; border-bottom: 2px solid #e5e5e5; padding: 8px 6px; }
  .txns td { padding: 8px 6px; border-bottom: 1px solid #f0f0f0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .row-opening td, .row-closing td { font-weight: 700; background: #fafafa; }
  .row-closing td { border-top: 2px solid #e5e5e5; font-size: 14px; }
  .section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; margin: 28px 0 8px; }
  .aging { width: 100%; border-collapse: collapse; }
  .aging th, .aging td { padding: 8px 6px; border: 1px solid #eee; text-align: center; font-size: 12px; }
  .aging th { background: #fafafa; color: #555; }
  .aging .total-due { font-weight: 700; }
  .footer-note { margin-top: 28px; color: #666; font-size: 12px; }
</style>
</head>
<body>
  <div class="header">
    <div>
      {{#company.logo}}<img class="logo" src="{{company.logo}}" alt="{{company.name}}" />{{/company.logo}}
      {{^company.logo}}<div class="company-name">{{company.name}}</div>{{/company.logo}}
      <div class="muted">
        {{#company.address}}{{{company.address}}}<br/>{{/company.address}}
        {{#company.email}}{{company.email}}<br/>{{/company.email}}
        {{#company.phone}}{{company.phone}}{{/company.phone}}
        {{#company.tax_id}}<br/>{{company.tax_id}}{{/company.tax_id}}
      </div>
    </div>
    <div class="meta">
      <h1>{{i18n.statement}}</h1>
      <div class="muted">{{i18n.statement_date}}: {{statement_date}}</div>
      <div class="muted">{{i18n.period}}: {{period.from}} – {{period.to}}</div>
    </div>
  </div>

  <div class="parties">
    <div>
      <div class="party-label">{{i18n.bill_to}}</div>
      <div><strong>{{customer.name}}</strong></div>
      <div class="muted">
        {{#customer.address}}{{{customer.address}}}<br/>{{/customer.address}}
        {{#customer.email}}{{customer.email}}<br/>{{/customer.email}}
        {{#customer.tax_id}}{{customer.tax_id}}{{/customer.tax_id}}
      </div>
    </div>
    <div class="meta">
      <div class="party-label">{{i18n.balance_due}}</div>
      <div style="font-size:22px;font-weight:700;">{{closing_balance}}</div>
    </div>
  </div>

  <table class="txns">
    <thead>
      <tr>
        <th>{{i18n.date}}</th>
        <th>{{i18n.reference}}</th>
        <th>{{i18n.description}}</th>
        <th class="num">{{i18n.charges}}</th>
        <th class="num">{{i18n.payments_credits}}</th>
        <th class="num">{{i18n.balance}}</th>
      </tr>
    </thead>
    <tbody>
      <tr class="row-opening">
        <td colspan="5">{{i18n.opening_balance}}</td>
        <td class="num">{{opening_balance}}</td>
      </tr>
      {{#lines}}
      <tr>
        <td>{{date}}</td>
        <td>{{reference}}</td>
        <td>{{description}}</td>
        <td class="num">{{charge}}</td>
        <td class="num">{{credit}}</td>
        <td class="num">{{balance}}</td>
      </tr>
      {{/lines}}
      {{^has_lines}}
      <tr><td colspan="6" class="muted" style="text-align:center;padding:16px;">{{i18n.no_activity}}</td></tr>
      {{/has_lines}}
      <tr class="row-closing">
        <td colspan="5">{{i18n.closing_balance}}</td>
        <td class="num">{{closing_balance}}</td>
      </tr>
    </tbody>
  </table>

  <div class="section-title">{{i18n.aging_summary}}</div>
  <table class="aging">
    <thead>
      <tr>
        {{#aging}}<th>{{label}}</th>{{/aging}}
        <th class="total-due">{{i18n.total_due}}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        {{#aging}}<td>{{amount}}</td>{{/aging}}
        <td class="total-due">{{aging_total}}</td>
      </tr>
    </tbody>
  </table>

  <div class="footer-note">{{i18n.footer_note}}</div>
</body>
</html>`;
