import { logger } from "../utils/logger";
import { getSetting } from "./settings.service";

/**
 * The base currency all consolidated reporting converts to. Falls back to the
 * legacy single `currency` setting, then USD, so existing single-currency
 * installs keep working without configuring anything.
 */
export function getBaseCurrency(): string {
  return getSetting("base_currency") || getSetting("currency") || "USD";
}

/** Whether the UI should auto-fetch a rate when a foreign currency is picked. */
export function isAutoFetchEnabled(): boolean {
  return getSetting("exchange_rate_auto_fetch") === "true";
}

/**
 * Cross-rate from `from` → `to` given a EUR-based rate table (as published by
 * the ECB: 1 EUR = rate[X] units of X; EUR itself is 1). Pure + synchronous so
 * it can be unit-tested without any network. Returns null if either currency is
 * absent from the table.
 */
export function crossRate(
  eurRates: Record<string, number>,
  from: string,
  to: string,
): number | null {
  const rates: Record<string, number> = { EUR: 1, ...eurRates };
  const f = rates[from.toUpperCase()];
  const t = rates[to.toUpperCase()];
  if (!f || !t) return null;
  // base-per-unit-of-`from` = (EUR→to) / (EUR→from)
  return t / f;
}

export interface RateProvider {
  name: string;
  /** EUR-based rate table, or null when unavailable (offline, parse error…). */
  fetchEurRates(): Promise<Record<string, number> | null>;
}

const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

/** Parse the ECB daily reference-rate XML into a { CUR: rate } map (no XML dep). */
export function parseEcbXml(xml: string): Record<string, number> {
  const out: Record<string, number> = {};
  const re = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((m = re.exec(xml)) !== null) {
    const value = parseFloat(m[2]);
    if (Number.isFinite(value)) out[m[1]] = value;
  }
  return out;
}

const ecbProvider: RateProvider = {
  name: "ecb",
  async fetchEurRates() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(ECB_DAILY_URL, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        logger.warn({ status: res.status }, "ECB rate fetch returned non-200");
        return null;
      }
      const xml = await res.text();
      const rates = parseEcbXml(xml);
      return Object.keys(rates).length > 0 ? rates : null;
    } catch (err) {
      // Offline / blocked / timeout — degrade gracefully to manual entry.
      logger.warn({ err }, "ECB rate fetch failed; falling back to manual entry");
      return null;
    }
  },
};

// Single provider for now; the seam keeps it swappable without touching callers.
function getProvider(): RateProvider {
  return ecbProvider;
}

// In-memory cache so a burst of form opens doesn't hammer the provider. Rates
// are daily, so a 1-hour TTL is plenty fresh while staying offline-friendly.
const CACHE_TTL_MS = 60 * 60 * 1000;
let cache: { rates: Record<string, number>; at: number } | null = null;

async function getEurRates(): Promise<Record<string, number> | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rates;
  const rates = await getProvider().fetchEurRates();
  if (rates) cache = { rates, at: Date.now() };
  return rates ?? cache?.rates ?? null;
}

/**
 * Best-effort live rate (base units per 1 unit of `from`). Returns null when
 * the provider is unreachable or a currency is unknown — callers fall back to
 * manual entry / a stored rate. Never throws.
 */
export async function fetchRate(from: string, to: string): Promise<number | null> {
  if (from.toUpperCase() === to.toUpperCase()) return 1;
  const eurRates = await getEurRates();
  if (!eurRates) return null;
  return crossRate(eurRates, from, to);
}

/** Test seam: drop the cached table so tests start from a known state. */
export function __clearRateCache(): void {
  cache = null;
}
