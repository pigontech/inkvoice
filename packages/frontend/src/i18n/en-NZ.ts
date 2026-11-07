import en, { type TranslationKeys } from "./en";

// English (New Zealand): identical to English, except NZ business wording:
// GST instead of tax, GST Number instead of Tax ID, financial instead of fiscal
// year, and a plain bank account number instead of an IBAN.
const enNZ: TranslationKeys = {
  ...en,
  invoices: {
    ...en.invoices,
    tax: "GST",
    no_tax: "No GST",
    prices_include_tax: "Prices include GST",
  },
  customers: {
    ...en.customers,
    tax_id: "GST Number",
  },
  products: {
    ...en.products,
    default_tax: "Default GST",
    no_default_tax: "No default GST",
  },
  expenses: {
    ...en.expenses,
    amount_info: "Amount & GST",
    tax: "GST",
    no_tax: "No GST",
  },
  quotes: {
    ...en.quotes,
    tax: "GST",
    no_tax: "No GST",
  },
  reports: {
    ...en.reports,
    tab_tax_summary: "GST Summary",
    tax_name: "GST Name",
    taxable_amount: "Amount excl. GST",
    tax_collected: "GST Collected",
    no_tax_data: "No GST data for this period.",
  },
  settings: {
    ...en.settings,
    tab_tax: "GST",
    tax_id: "GST Number",
    tax_label: "GST Label",
    tax_label_placeholder: "GST",
    fiscal_year_start: "Financial Year Start",
    fiscal_year_start_hint:
      "Month the financial year begins (April for most NZ businesses). Affects 'This Year' / 'Last Year' presets.",
    bank_details_placeholder: "Bank: …\nAccount name: …",
    account_number_hint:
      "Your NZ bank account number, e.g. 12-3456-7890123-00. Printed on every invoice.",
    tax_settings: "GST Settings",
    default_tax_rate: "Default GST rate (%)",
    prices_include_tax: "Prices include GST?",
    tax_definitions: "GST definitions",
    add_tax: "Add GST rate",
    edit_tax: "Edit GST rate",
    no_tax_definitions: "No GST definitions yet.",
    confirm_delete_tax:
      "Are you sure you want to delete this GST definition? GST definitions in use cannot be deleted.",
    tax_created: "GST definition created",
    tax_updated: "GST definition updated",
    tax_deleted: "GST definition deleted",
  },
  templates: {
    ...en.templates,
    tax_summary_hint:
      "Use inside {{#tax_summary}}...{{/tax_summary}} section to loop over GST entries.",
  },
};

export default enNZ;
