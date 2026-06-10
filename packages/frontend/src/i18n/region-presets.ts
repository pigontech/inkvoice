// Country presets applied during the onboarding "Where are you based?" step.
// Only currency + locale + date_format are propagated to settings here. The
// optional `default_tax` is surfaced for a later step / tax setup; capturing
// it as data keeps the wizard simple while not losing the info.

export interface RegionPreset {
  country: string; // ISO 3166-1 alpha-2
  label: string; // Display name (translated in the wizard if desired)
  currency: string; // ISO 4217
  locale: string; // BCP-47
  date_format: string; // settings.date_format value
  default_tax?: { name: string; rate: number };
}

export const REGION_PRESETS: RegionPreset[] = [
  {
    country: "TR",
    label: "Türkiye",
    currency: "TRY",
    locale: "tr-TR",
    date_format: "dd.MM.yyyy",
    default_tax: { name: "KDV", rate: 20 },
  },
  {
    country: "US",
    label: "United States",
    currency: "USD",
    locale: "en-US",
    date_format: "MM/dd/yyyy",
  },
  {
    country: "GB",
    label: "United Kingdom",
    currency: "GBP",
    locale: "en-GB",
    date_format: "dd/MM/yyyy",
    default_tax: { name: "VAT", rate: 20 },
  },
  {
    country: "DE",
    label: "Deutschland",
    currency: "EUR",
    locale: "de-DE",
    date_format: "dd.MM.yyyy",
    default_tax: { name: "USt", rate: 19 },
  },
  {
    country: "FR",
    label: "France",
    currency: "EUR",
    locale: "fr-FR",
    date_format: "dd/MM/yyyy",
    default_tax: { name: "TVA", rate: 20 },
  },
  {
    country: "ES",
    label: "España",
    currency: "EUR",
    locale: "es-ES",
    date_format: "dd/MM/yyyy",
    default_tax: { name: "IVA", rate: 21 },
  },
  {
    country: "IT",
    label: "Italia",
    currency: "EUR",
    locale: "it-IT",
    date_format: "dd/MM/yyyy",
    default_tax: { name: "IVA", rate: 22 },
  },
  {
    country: "NL",
    label: "Nederland",
    currency: "EUR",
    locale: "nl-NL",
    date_format: "dd-MM-yyyy",
    default_tax: { name: "BTW", rate: 21 },
  },
  {
    country: "IE",
    label: "Ireland",
    currency: "EUR",
    locale: "en-IE",
    date_format: "dd/MM/yyyy",
    default_tax: { name: "VAT", rate: 23 },
  },
  {
    country: "AU",
    label: "Australia",
    currency: "AUD",
    locale: "en-AU",
    date_format: "dd/MM/yyyy",
    default_tax: { name: "GST", rate: 10 },
  },
  { country: "CA", label: "Canada", currency: "CAD", locale: "en-CA", date_format: "yyyy-MM-dd" },
  {
    country: "CH",
    label: "Schweiz",
    currency: "CHF",
    locale: "de-CH",
    date_format: "dd.MM.yyyy",
    default_tax: { name: "MWST", rate: 8.1 },
  },
  {
    country: "SE",
    label: "Sverige",
    currency: "SEK",
    locale: "sv-SE",
    date_format: "yyyy-MM-dd",
    default_tax: { name: "Moms", rate: 25 },
  },
  {
    country: "NO",
    label: "Norge",
    currency: "NOK",
    locale: "nb-NO",
    date_format: "dd.MM.yyyy",
    default_tax: { name: "MVA", rate: 25 },
  },
];

export function findPresetByCountry(country: string): RegionPreset | undefined {
  return REGION_PRESETS.find((p) => p.country === country.toUpperCase());
}

/** Detect a default country from the browser's Accept-Language tag. */
export function detectDefaultCountry(): string {
  const lang = (typeof navigator !== "undefined" ? navigator.language : "") || "";
  // Tags like "tr-TR", "de-DE", "en-US" — take the region.
  const parts = lang.split("-");
  const region = parts[1]?.toUpperCase();
  if (region && REGION_PRESETS.some((p) => p.country === region)) return region;
  // No region: try to map the language to a likely country.
  const fallbacks: Record<string, string> = {
    tr: "TR",
    de: "DE",
    fr: "FR",
    es: "ES",
    it: "IT",
    nl: "NL",
    sv: "SE",
    nb: "NO",
    no: "NO",
    en: "US",
  };
  return fallbacks[parts[0]?.toLowerCase() ?? ""] ?? "US";
}
