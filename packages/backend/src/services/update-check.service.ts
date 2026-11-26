// Tells an admin whether this install runs the latest open-source release.
// The lookup runs on the server for the same reasons as the plugin catalog:
// one predictable outbound request per install instead of one per browser, no
// CORS or CSP change, and one switch (UPDATE_CHECK=false) that turns it off.
//
// The sidebar must never wait on GitHub or show an error: every failure path
// answers "unknown" (latest: null) and the UI then shows the plain version.

import { gt } from "../plugins/semver";
import { getEnv } from "../utils/env";
import { logger } from "../utils/logger";
import { safeFetchJson } from "../utils/safe-fetch";
import { APP_VERSION } from "../utils/version";
import { getSetting, updateSettings } from "./settings.service";

/** GitHub's "latest release": the newest release that is neither a draft nor a prerelease. */
export const LATEST_RELEASE_API_URL =
  "https://api.github.com/repos/pigontech/inkvoice/releases/latest";
/** Where the "update available" link in the UI points. */
export const LATEST_RELEASE_PAGE_URL = "https://github.com/pigontech/inkvoice/releases/latest";
export const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000;
/** After a failed lookup, wait this long before asking again. */
export const UPDATE_CHECK_RETRY_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

export const UPDATE_CHECK_CACHE_KEY = "update_check_cache";

interface UpdateCheckCache {
  /** Latest release as MAJOR.MINOR.PATCH, null when it has never been read. */
  latest: string | null;
  checkedAt: string;
  /** Whether the lookup at `checkedAt` succeeded. */
  ok: boolean;
}

export interface UpdateCheckResult {
  /** False when UPDATE_CHECK=false; nothing is fetched or cached then. */
  enabled: boolean;
  current: string;
  latest: string | null;
  update_available: boolean;
  release_url: string;
  checked_at: string | null;
}

/** Resolves with the latest release version, or null when it cannot be read. */
export type LatestReleaseFetcher = () => Promise<string | null>;

/** "v1.2.3" or "1.2.3" becomes "1.2.3"; anything else (prerelease tags included) is null. */
export function parseReleaseTag(tag: unknown): string | null {
  if (typeof tag !== "string") return null;
  const match = /^v?(\d+\.\d+\.\d+)$/.exec(tag.trim());
  return match ? match[1] : null;
}

const fetchLatestFromGitHub: LatestReleaseFetcher = async () => {
  const payload = (await safeFetchJson(LATEST_RELEASE_API_URL, {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxBytes: MAX_RESPONSE_BYTES,
    headers: {
      Accept: "application/vnd.github+json",
      // GitHub rejects API requests without a User-Agent.
      "User-Agent": `inkvoice/${APP_VERSION}`,
    },
  })) as { tag_name?: unknown } | null;
  return parseReleaseTag(payload?.tag_name);
};

let fetcher: LatestReleaseFetcher = fetchLatestFromGitHub;

/** Replace the release lookup (tests, or a host with its own source). Null restores the default. */
export function setLatestReleaseFetcher(fn: LatestReleaseFetcher | null): void {
  fetcher = fn ?? fetchLatestFromGitHub;
}

function readCache(): UpdateCheckCache | null {
  const raw = getSetting(UPDATE_CHECK_CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<UpdateCheckCache>;
    if (typeof parsed.checkedAt !== "string") return null;
    return {
      latest: parseReleaseTag(parsed.latest),
      checkedAt: parsed.checkedAt,
      ok: parsed.ok === true,
    };
  } catch {
    return null;
  }
}

function isFresh(cache: UpdateCheckCache): boolean {
  const at = Date.parse(cache.checkedAt);
  if (Number.isNaN(at)) return false;
  return Date.now() - at < (cache.ok ? UPDATE_CHECK_TTL_MS : UPDATE_CHECK_RETRY_MS);
}

export async function getUpdateCheck(): Promise<UpdateCheckResult> {
  const base = { current: APP_VERSION, release_url: LATEST_RELEASE_PAGE_URL };
  if (!getEnv().UPDATE_CHECK) {
    return { ...base, enabled: false, latest: null, update_available: false, checked_at: null };
  }

  let cache = readCache();
  if (!cache || !isFresh(cache)) {
    let latest: string | null = null;
    try {
      latest = await fetcher();
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Update check failed");
    }
    // A failed lookup keeps the last known release, so one outage does not
    // hide an update the install already knew about.
    cache = {
      latest: latest ?? cache?.latest ?? null,
      checkedAt: new Date().toISOString(),
      ok: latest !== null,
    };
    updateSettings({ [UPDATE_CHECK_CACHE_KEY]: JSON.stringify(cache) });
  }

  return {
    ...base,
    enabled: true,
    latest: cache.latest,
    // A build newer than the latest release (a dev checkout) counts as up to date.
    update_available: cache.latest !== null && gt(cache.latest, APP_VERSION),
    checked_at: cache.checkedAt,
  };
}
