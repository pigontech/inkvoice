#!/usr/bin/env bun
// Writes a set of German sample e-invoices (XRechnung XML, ZUGFeRD XML and
// hybrid PDF) by driving the real API in-process against a throwaway
// database, with the payload the invoice form sends. CI validates the output
// with the official KoSIT validator and Mustang
// (.github/workflows/einvoice-conformance.yml); see docs/features/e-invoicing.md
// to run the same check locally.
//
//   bun run scripts/einvoice-samples.ts <outDir>

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const outDir = resolve(process.argv[2] || "einvoice-samples");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const dbPath = join(outDir, "samples.db");
process.env.DATABASE_PATH = dbPath;
process.env.ADMIN_USER = "admin";
process.env.ADMIN_PASS = "sample-pass-123456";
process.env.JWT_SECRET = "sample-secret-key-that-is-at-least-32-chars";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.LOG_LEVEL = "error";

const { resetEnvCache } = await import("../packages/backend/src/utils/env");
const { closeDatabase, getDb, initDatabase } = await import(
  "../packages/backend/src/database/connection"
);
const { runMigrations, setMigrationBackupsEnabled } = await import(
  "../packages/backend/src/database/migrations"
);
const { seed } = await import("../packages/backend/src/database/seed");
const { createApp } = await import("../packages/backend/src/app");

resetEnvCache();
setMigrationBackupsEnabled(false);
initDatabase();
runMigrations();
// A German install: the country is known at first boot, so the German VAT
// presets (19 %, 7 %, 0 %, exempt) are seeded.
getDb().run("INSERT OR REPLACE INTO settings (key, value) VALUES ('company_country', 'DE')");
await seed();
const app = createApp();

const login = await app.request("/api/v1/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "sample-pass-123456" }),
});
const token = ((await login.json()) as { data: { token: string } }).data.token;

async function api(method: string, path: string, body?: unknown) {
  const res = await app.request(
    new Request(`http://localhost${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res;
}
async function json(method: string, path: string, body?: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: test script, loose API payloads
  return ((await (await api(method, path, body)).json()) as any).data;
}

const taxes = (await json("GET", "/api/v1/tax-definitions")) as {
  id: string;
  rate: number;
  category_code: string;
}[];
const taxId = (rate: number, code: string) => {
  const t = taxes.find((x) => x.rate === rate && x.category_code === code);
  if (!t) throw new Error(`no tax definition ${rate} % ${code}`);
  return t.id;
};
const T19 = taxId(19, "S");
const T7 = taxId(7, "S");
const TE = taxId(0, "E");
const TAE = (
  await json("POST", "/api/v1/tax-definitions", {
    name: "Reverse Charge (§ 13b UStG)",
    rate: 0,
    category_code: "AE",
  })
).id as string;

// A complete seller profile, as a German freelancer fills it in Settings.
await api("PUT", "/api/v1/settings", {
  company_name: "Anna Beispiel Design",
  company_email: "rechnung@example.com",
  company_phone: "+49 30 1234567",
  company_street: "Musterstraße 12",
  company_city: "Berlin",
  company_postal_code: "10115",
  company_country: "DE",
  company_tax_id: "DE123456789",
  company_tax_number: "12/345/67890",
  company_iban: "DE02120300000000202051",
  company_bic: "BYLADEM1001",
  company_account_holder: "Anna Beispiel",
  company_bank_details: "IBAN DE02 1203 0000 0000 2020 51, BIC BYLADEM1001",
  locale: "de",
  currency: "EUR",
  einvoice_enabled: "true",
  einvoice_kleinunternehmer: "false",
});

const buyer = {
  name: "Kunde GmbH",
  email: "buchhaltung@example.org",
  country: "DE",
  tax_id: "DE987654321",
  address_line1: "Marktplatz 2",
  city: "Hamburg",
  postal_code: "20095",
};
const euBuyer = {
  name: "Kunde Wien GmbH",
  email: "office@example.at",
  country: "AT",
  tax_id: "ATU12345678",
  address_line1: "Ringstraße 1",
  city: "Wien",
  postal_code: "1010",
};
const customer = async (body: Record<string, unknown>) =>
  (await json("POST", "/api/v1/customers", body)).id as string;
const zugferd = await customer({ ...buyer, einvoice_format: "zugferd" });
const xrechnung = await customer({ ...buyer, einvoice_format: "xrechnung" });
const publicBody = await customer({
  name: "Stadtverwaltung Musterstadt",
  email: "e-rechnung@example.org",
  country: "DE",
  address_line1: "Rathausplatz 1",
  city: "Musterstadt",
  postal_code: "12345",
  leitweg_id: "04011000-1234512345-06",
});
const euZugferd = await customer({ ...euBuyer, einvoice_format: "zugferd" });
const euXrechnung = await customer({ ...euBuyer, einvoice_format: "xrechnung" });

const standard = [
  { description: "Konzeption und Beratung", quantity: 8, unit_price: 95, unit: "hour", tax_id: T19, tax_rate: 19 },
  { description: "Webdesign Startseite (pauschal)", quantity: 1, unit_price: 1200, unit: "lump_sum", tax_id: T19, tax_rate: 19 },
];
const mixed = [
  { description: "Lektorat Fachartikel", quantity: 6, unit_price: 70, unit: "hour", tax_id: T19, tax_rate: 19 },
  { description: "Nutzungsrechte Fotografie", quantity: 1, unit_price: 300, unit: "piece", tax_id: T7, tax_rate: 7 },
];
const reverseCharge = [
  { description: "Beratung (Remote)", quantity: 10, unit_price: 95, unit: "hour", tax_id: TAE, tax_rate: 0 },
];
const smallBusiness = [
  { description: "Illustration Buchcover", quantity: 1, unit_price: 450, unit: "piece", tax_id: TE, tax_rate: 0 },
];

async function invoice(customerId: string, items: unknown[], extra: Record<string, unknown> = {}) {
  const inv = await json("POST", "/api/v1/invoices", {
    customer_id: customerId,
    issue_date: "2026-11-02",
    due_date: "2026-11-16",
    currency: "EUR",
    locale: "de",
    payment_terms: "Zahlbar innerhalb von 14 Tagen ohne Abzug.",
    items,
    ...extra,
  });
  // Finalise like the send flow does: the real number, status sent.
  await api("POST", `/api/v1/invoices/${inv.id}/mark-sent`);
  return inv.id as string;
}

async function emit(name: string, invoiceId: string) {
  const record = await json("POST", `/api/v1/invoices/${invoiceId}/einvoice/emit`);
  const errors = (record.issues as { severity: string; code: string }[]).filter(
    (i) => i.severity === "error",
  );
  if (errors.length) throw new Error(`${name}: ${errors.map((e) => e.code).join(", ")}`);
  const base = `/api/v1/invoices/${invoiceId}/einvoices/${record.id}`;
  writeFileSync(join(outDir, `${name}.xml`), await (await api("GET", `${base}/xml`)).text());
  if (record.format === "zugferd") {
    const pdf = await api("GET", `${base}/pdf`);
    writeFileSync(join(outDir, `${name}.pdf`), new Uint8Array(await pdf.arrayBuffer()));
  }
}

await emit("01-zugferd-19", await invoice(zugferd, standard));
await emit("02-xrechnung-19", await invoice(xrechnung, standard));
await emit("03-xrechnung-leitweg-id", await invoice(publicBody, standard));
await emit("04-zugferd-19-and-7", await invoice(zugferd, mixed));
await emit("05-xrechnung-19-and-7", await invoice(xrechnung, mixed));
const discount = { discount_type: "percentage", discount_value: 10 };
await emit("06-zugferd-discount", await invoice(zugferd, mixed, discount));
await emit("07-xrechnung-discount", await invoice(xrechnung, mixed, discount));
await emit("08-zugferd-reverse-charge", await invoice(euZugferd, reverseCharge));
await emit("09-xrechnung-reverse-charge", await invoice(euXrechnung, reverseCharge));

// Credit notes for a sent invoice, in both formats.
const credited = await invoice(xrechnung, standard);
const creditNote = (await json("POST", `/api/v1/invoices/${credited}/credit-note`)).id as string;
await emit("10-xrechnung-credit-note", creditNote);
await api("PUT", `/api/v1/customers/${xrechnung}`, { ...buyer, einvoice_format: "zugferd" });
await emit("11-zugferd-credit-note", creditNote);
await api("PUT", `/api/v1/customers/${xrechnung}`, { ...buyer, einvoice_format: "xrechnung" });

// The other VAT categories a German freelancer meets: zero rated (next to
// 19 %), exempt, export outside the EU and not subject to VAT. Intra-community
// supplies (K) also need a delivery country, which Inkvoice can't record yet.
const category = async (name: string, code: string) =>
  (await json("POST", "/api/v1/tax-definitions", { name, rate: 0, category_code: code }))
    .id as string;
const TZ = await category("Nullsatz (§ 12 Abs. 3 UStG)", "Z");
const TEX = await category("Steuerfrei nach § 4 Nr. 21 UStG", "E");
const TG = await category("Ausfuhrlieferung (§ 4 Nr. 1a UStG)", "G");
const TO = await category("Nicht im Inland steuerbare Leistung", "O");
const nonEuBuyer = {
  name: "Kunde Zürich AG",
  email: "kreditoren@example.ch",
  country: "CH",
  tax_id: "CHE-123.456.789 MWST",
  address_line1: "Bahnhofstrasse 1",
  city: "Zürich",
  postal_code: "8001",
};
const nonEuZugferd = await customer({ ...nonEuBuyer, einvoice_format: "zugferd" });
const nonEuXrechnung = await customer({ ...nonEuBuyer, einvoice_format: "xrechnung" });
const zeroRated = [
  ...standard,
  { description: "Photovoltaikanlage 10 kWp inkl. Montage", quantity: 1, unit_price: 9800, unit: "piece", tax_id: TZ, tax_rate: 0 },
];
const exempt = [
  { description: "Sprachkurs Deutsch B1", quantity: 10, unit_price: 60, unit: "hour", tax_id: TEX, tax_rate: 0 },
];
const exportGoods = [
  { description: "Kunstdrucke, Ausfuhr", quantity: 10, unit_price: 100, unit: "piece", tax_id: TG, tax_rate: 0 },
];
const notSubject = [
  { description: "Beratung (Leistungsort Schweiz)", quantity: 10, unit_price: 95, unit: "hour", tax_id: TO, tax_rate: 0 },
];
await emit("14-zugferd-zero-rated", await invoice(zugferd, zeroRated));
await emit("15-xrechnung-zero-rated", await invoice(xrechnung, zeroRated));
await emit("16-zugferd-exempt", await invoice(zugferd, exempt));
await emit("17-xrechnung-exempt", await invoice(xrechnung, exempt));
await emit("18-zugferd-export", await invoice(nonEuZugferd, exportGoods));
await emit("19-xrechnung-export", await invoice(nonEuXrechnung, exportGoods));
await emit("20-zugferd-not-subject", await invoice(nonEuZugferd, notSubject));
await emit("21-xrechnung-not-subject", await invoice(nonEuXrechnung, notSubject));

// The date of supply (Leistungsdatum, § 14 Abs. 4 Nr. 6 UStG): one date
// (BT-72) or a service period (BG-14).
const serviceDate = { service_date: "2026-10-30" };
const servicePeriod = { service_period_start: "2026-10-01", service_period_end: "2026-10-31" };
await emit("22-zugferd-service-date", await invoice(zugferd, standard, serviceDate));
await emit("23-xrechnung-service-date", await invoice(xrechnung, standard, serviceDate));
await emit("24-zugferd-service-period", await invoice(zugferd, standard, servicePeriod));
await emit("25-xrechnung-service-period", await invoice(xrechnung, standard, servicePeriod));

// Kleinunternehmer (§ 19 UStG): no USt-IdNr, no VAT.
await api("PUT", "/api/v1/settings", { einvoice_kleinunternehmer: "true", company_tax_id: "" });
await emit("12-zugferd-kleinunternehmer", await invoice(zugferd, smallBusiness));
await emit("13-xrechnung-kleinunternehmer", await invoice(xrechnung, smallBusiness));

closeDatabase();
for (const f of readdirSync(outDir)) if (f.startsWith("samples.db")) rmSync(join(outDir, f));
console.log(`Wrote ${readdirSync(outDir).length} files to ${outDir}`);
process.exit(0);
