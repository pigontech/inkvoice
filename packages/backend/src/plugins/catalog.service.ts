// Fetches the public plugin catalog server-side, caches it in the settings KV
// on a TTL, and falls back to a snapshot committed to this repo. Server-side so
// that a self-hosted install makes one predictable outbound request from the
// server rather than one per browser, with no CORS and one place to switch it
// off.
//
// The tab must never be empty and never spin: a remote fetch only ever improves
// the data. Every failure path still returns a usable catalog plus a reason.

import { createHmac, randomBytes } from "node:crypto";
import { getSetting, updateSettings } from "../services/settings.service";
import { logger } from "../utils/logger";
import { SafeFetchError, type SafeFetchErrorCode, safeFetchJson } from "../utils/safe-fetch";
import snapshot from "./catalog-snapshot.json";

export const DEFAULT_CATALOG_URL = "https://inkvoice.app/plugins/catalog.v1.json";
export const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
/** The published catalog is a few KB. The cap exists so a hostile endpoint
 *  cannot stream gigabytes into memory and then into the settings row. */
const MAX_CATALOG_BYTES = 1024 * 1024;

const KEY_URL = "plugin_catalog_url";
const KEY_CACHE = "plugin_catalog_cache";
const KEY_SYNCED_AT = "plugin_catalog_synced_at";
const KEY_VOTES = "plugin_catalog_votes";
const KEY_VOTES_AT = "plugin_catalog_votes_at";
const KEY_VOTE_SECRET = "plugin_vote_secret";

export interface CatalogVersion {
  version: string;
  min_app: string;
  released: string;
  changelog?: string;
}

export interface CatalogScreenshot {
  url: string;
  alt: string;
}

export interface CatalogPlugin {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  status: "available" | "planned";
  availability: "oss" | "cloud" | "both";
  /** The plugin's `feature` id, gating it on a Cloud plan. Null when ungated. */
  requires_feature: string | null;
  icon: string;
  docs: string;
  source: string | null;
  screenshots: CatalogScreenshot[];
  latest: CatalogVersion | null;
  versions: CatalogVersion[];
}

export interface Catalog {
  schema: number;
  generated_at?: string;
  plugins: CatalogPlugin[];
}

/** Coarse, non-identifying failure reason. Deliberately not the underlying
 *  message: the catalog URL is operator-configurable and the result is shown to
 *  any authenticated user, so a verbatim "connect ECONNREFUSED 10.0.0.5:6379"
 *  would turn the Plugins tab into an internal network scanner. The detail is
 *  logged instead. */
export type CatalogErrorCode = SafeFetchErrorCode | "invalid_schema";

export interface CatalogResult {
  catalog: Catalog;
  source: "remote" | "cache" | "snapshot";
  /** ISO timestamp of the last successful remote fetch, null if never. */
  syncedAt: string | null;
  /** Why the remote was not used this time, null when it was. */
  error: CatalogErrorCode | null;
}

/** The configured source URL. Empty string means egress is switched off. */
function catalogUrl(): string {
  const raw = getSetting(KEY_URL);
  return raw === null ? DEFAULT_CATALOG_URL : raw;
}

export function catalogEgressEnabled(): boolean {
  return catalogUrl() !== "";
}

/** Host of the configured source, for the tab's provenance line. Null when
 *  egress is off. The host rather than the full URL: it is what identifies the
 *  source to a reader, and a path can carry a token. */
export function catalogHost(): string | null {
  const url = catalogUrl();
  if (url === "") return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Vote endpoints live on the same origin as the catalog. Derived rather than
 *  hardcoded so that repointing the catalog at a private mirror moves ALL of
 *  this feature's egress with it, instead of leaving votes going to
 *  inkvoice.app from an install that thought it had been redirected. */
function voteUrl(path: string): string | null {
  const url = catalogUrl();
  if (url === "") return null;
  try {
    return new URL(path, new URL(url).origin).toString();
  } catch {
    return null;
  }
}

/** Shape check. Deliberately shallow: we validate the envelope and let unknown
 *  plugin fields through, because the contract promises additive v1 changes. */
function isCatalog(value: unknown): value is Catalog {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.schema === 1 && Array.isArray(v.plugins);
}

function readCache(): { catalog: Catalog; syncedAt: string | null } | null {
  const raw = getSetting(KEY_CACHE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isCatalog(parsed)) return null;
    return { catalog: parsed, syncedAt: getSetting(KEY_SYNCED_AT) || null };
  } catch {
    return null;
  }
}

function isFresh(syncedAt: string | null): boolean {
  if (!syncedAt) return false;
  const at = Date.parse(syncedAt);
  if (Number.isNaN(at)) return false;
  return Date.now() - at < CATALOG_TTL_MS;
}

/** The URL is settings-controlled, so every fetch goes through the SSRF-aware
 *  helper: private ranges refused, redirects re-validated, body size capped. */
async function fetchJson(url: string): Promise<unknown> {
  return safeFetchJson(url, { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_CATALOG_BYTES });
}

/** Map any thrown value onto the coarse code the client is allowed to see,
 *  logging the real reason for the operator. */
function errorCode(err: unknown, context: Record<string, unknown>): CatalogErrorCode {
  const code: CatalogErrorCode = err instanceof SafeFetchError ? err.code : "unreachable";
  logger.warn({ ...context, code, err: (err as Error).message }, "Plugin catalog request failed");
  return code;
}

function snapshotResult(error: CatalogErrorCode | null, syncedAt: string | null): CatalogResult {
  return {
    catalog: snapshot as unknown as Catalog,
    source: "snapshot",
    syncedAt,
    error,
  };
}

/** Upstream plugins this Tunisia build drops: e-invoicing (PEPPOL, French PDP)
 *  was removed, so their managed transports have nothing to plug into. Filtered
 *  here rather than in the snapshot, which `sync:catalog` regenerates. */
const EXCLUDED_PLUGIN_IDS = new Set(["peppol", "france"]);

export async function getCatalog(opts: { force?: boolean } = {}): Promise<CatalogResult> {
  const result = await loadCatalog(opts);
  const plugins = result.catalog.plugins.filter((p) => !EXCLUDED_PLUGIN_IDS.has(p.id));
  return { ...result, catalog: { ...result.catalog, plugins } };
}

/**
 * Resolution order: fresh cache, then remote, then stale cache, then the
 * bundled snapshot. With egress off, only the snapshot is ever consulted.
 */
async function loadCatalog(opts: { force?: boolean }): Promise<CatalogResult> {
  const url = catalogUrl();
  if (url === "") return snapshotResult(null, null);

  const cached = readCache();
  if (!opts.force && cached && isFresh(cached.syncedAt)) {
    return { catalog: cached.catalog, source: "cache", syncedAt: cached.syncedAt, error: null };
  }

  let code: CatalogErrorCode;
  try {
    const payload = await fetchJson(url);
    if (isCatalog(payload)) {
      const syncedAt = new Date().toISOString();
      updateSettings({
        [KEY_CACHE]: JSON.stringify(payload),
        [KEY_SYNCED_AT]: syncedAt,
      });
      return { catalog: payload, source: "remote", syncedAt, error: null };
    }
    logger.warn({ url }, "Plugin catalog response had an unexpected shape");
    code = "invalid_schema";
  } catch (err) {
    code = errorCode(err, { url });
  }

  if (cached) {
    return { catalog: cached.catalog, source: "cache", syncedAt: cached.syncedAt, error: code };
  }
  return snapshotResult(code, null);
}

/** Per-install secret behind the vote identity below. Created on first use and
 *  never leaves the server; only HMACs of it are sent. */
function voteSecret(): string {
  const existing = getSetting(KEY_VOTE_SECRET);
  if (existing) return existing;
  const secret = randomBytes(32).toString("hex");
  updateSettings({ [KEY_VOTE_SECRET]: secret });
  return secret;
}

/**
 * Opaque per-install, per-user vote identity.
 *
 * Votes are proxied through this server, so the address the vote endpoint sees
 * belongs to the install, not the person. Without this every user of a
 * self-hosted install (and every tenant of a hosted deployment) would be one
 * voter, and the second person to click would get a success message for a vote
 * that was silently discarded. Hashing the user id under an install-local
 * secret keeps the user id off the wire and makes the identity meaningless to
 * anyone but this install.
 */
export function voteIdentity(userId: string): string {
  return createHmac("sha256", voteSecret()).update(userId).digest("hex").slice(0, 32);
}

/** Demand-vote counts by plugin id. Empty when egress is off or unreachable.
 *  Votes carry their own freshness clock: sharing the catalog's would let a
 *  catalog refresh mark a stale vote map fresh, and a failing catalog fetch
 *  make every request refetch the votes. */
export async function getVotes(): Promise<Record<string, number>> {
  const url = voteUrl("/api/plugin-votes");
  if (url === null) return {};

  const cachedRaw = getSetting(KEY_VOTES);
  if (cachedRaw && isFresh(getSetting(KEY_VOTES_AT))) {
    try {
      return JSON.parse(cachedRaw) as Record<string, number>;
    } catch {
      // fall through and refetch
    }
  }

  try {
    const payload = await safeFetchJson(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_CATALOG_BYTES,
    });
    if (typeof payload !== "object" || payload === null) return {};
    const counts = payload as Record<string, number>;
    updateSettings({
      [KEY_VOTES]: JSON.stringify(counts),
      [KEY_VOTES_AT]: new Date().toISOString(),
    });
    return counts;
  } catch (err) {
    errorCode(err, { url });
    if (cachedRaw) {
      try {
        return JSON.parse(cachedRaw) as Record<string, number>;
      } catch {
        return {};
      }
    }
    return {};
  }
}

export interface VoteOutcome {
  /** The new count, null when nothing could be read. */
  count: number | null;
  /** True when this identity had already voted, so nothing was recorded.
   *  Distinguished from a fresh vote so the UI can say which happened rather
   *  than showing success for a write that never occurred. */
  alreadyVoted: boolean;
  status: "recorded" | "already_voted" | "off" | "rejected" | "failed";
}

/** Registers interest in a planned plugin on behalf of one user. */
export async function postVote(id: string, userId: string): Promise<VoteOutcome> {
  const url = voteUrl("/api/plugin-vote");
  if (url === null) return { count: null, alreadyVoted: false, status: "off" };
  try {
    const data = (await safeFetchJson(url, {
      method: "POST",
      timeoutMs: FETCH_TIMEOUT_MS,
      headers: {
        "Content-Type": "application/json",
        "X-Inkvoice-Vote-Key": voteIdentity(userId),
      },
      body: JSON.stringify({ id }),
    })) as { count?: number; alreadyVoted?: boolean };
    const count = typeof data.count === "number" ? data.count : null;
    const alreadyVoted = data.alreadyVoted === true;
    return { count, alreadyVoted, status: alreadyVoted ? "already_voted" : "recorded" };
  } catch (err) {
    const code = errorCode(err, { id, url });
    // A 4xx means the endpoint understood us and said no: the plugin is not
    // open for votes, or the cap was hit. That is not the same as being
    // offline, and the user deserves to be told the difference.
    const status = code === "http_error" ? "rejected" : "failed";
    return { count: null, alreadyVoted: false, status };
  }
}
