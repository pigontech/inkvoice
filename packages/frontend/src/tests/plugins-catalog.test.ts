import { afterEach, describe, expect, test } from "bun:test";
import {
  blockedChipKey,
  type CatalogErrorCode,
  type CatalogPluginEntry,
  type CatalogProvenance,
  canShowUpdates,
  canVote,
  catalogErrorKey,
  catalogOrigin,
  deriveEnabledIds,
  filterPlugins,
  footerState,
  loadViewPreference,
  minutesSince,
  saveViewPreference,
  VIEW_STORAGE_KEY,
  voteToastKey,
} from "../plugins/catalog";

function entry(over: Partial<CatalogPluginEntry> = {}): CatalogPluginEntry {
  return {
    id: "time-tracker",
    name: "Time Tracker",
    tagline: "Track billable hours.",
    description: "Body.",
    category: "productivity",
    status: "available",
    availability: "both",
    icon: "Clock",
    docs: null,
    source: null,
    screenshots: [],
    installed: true,
    installedVersion: "1.0.0",
    latestVersion: "1.0.0",
    updateAvailable: false,
    updateRequiresApp: null,
    enabled: true,
    blockedReason: null,
    votes: 0,
    ...over,
  };
}

function prov(over: Partial<CatalogProvenance> = {}): CatalogProvenance {
  return { source: "remote", syncedAt: null, error: null, egressEnabled: true, ...over };
}

const fakeStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  };
};

describe("deriveEnabledIds", () => {
  test("keeps installed and enabled entries only", () => {
    expect(
      deriveEnabledIds([
        entry(),
        entry({ id: "off", enabled: false }),
        entry({ id: "planned", installed: false, enabled: false, status: "planned" }),
      ]),
    ).toEqual(["time-tracker"]);
  });
});

describe("filterPlugins", () => {
  const entries = [
    entry(),
    entry({ id: "off", name: "Data Backup", enabled: false }),
    entry({
      id: "acme-sync",
      name: "Acme Sync",
      category: "compliance",
      installed: false,
      enabled: false,
      blockedReason: "cloud_only",
    }),
    entry({
      id: "planned-one",
      name: "Accounts Payable",
      status: "planned",
      installed: false,
      enabled: false,
      blockedReason: "planned",
      votes: 12,
    }),
  ];

  test("no filters returns everything", () => {
    expect(filterPlugins(entries, { query: "", category: "all", status: "all" })).toHaveLength(4);
  });

  test("search is a case-insensitive substring over name, tagline and category", () => {
    expect(
      filterPlugins(entries, { query: "time tra", category: "all", status: "all" }).map(
        (p) => p.id,
      ),
    ).toEqual(["time-tracker"]);
    expect(
      filterPlugins(entries, { query: "ACME", category: "all", status: "all" }).map((p) => p.id),
    ).toEqual(["acme-sync"]);
    expect(
      filterPlugins(entries, { query: "compliance", category: "all", status: "all" }).map(
        (p) => p.id,
      ),
    ).toEqual(["acme-sync"]);
  });

  test("category filter matches exactly", () => {
    expect(
      filterPlugins(entries, { query: "", category: "compliance", status: "all" }).map((p) => p.id),
    ).toEqual(["acme-sync"]);
  });

  test("status chips: enabled shows enabled entries only", () => {
    expect(
      filterPlugins(entries, { query: "", category: "all", status: "enabled" }).map((p) => p.id),
    ).toEqual(["time-tracker"]);
  });

  test("status chips: disabled shows installed but not enabled, never planned", () => {
    expect(
      filterPlugins(entries, { query: "", category: "all", status: "disabled" }).map((p) => p.id),
    ).toEqual(["off"]);
  });

  test("status chips: planned shows planned entries only", () => {
    expect(
      filterPlugins(entries, { query: "", category: "all", status: "planned" }).map((p) => p.id),
    ).toEqual(["planned-one"]);
  });

  test("search and filters compose", () => {
    expect(
      filterPlugins(entries, { query: "payable", category: "all", status: "planned" }).map(
        (p) => p.id,
      ),
    ).toEqual(["planned-one"]);
    expect(
      filterPlugins(entries, { query: "payable", category: "compliance", status: "planned" }),
    ).toEqual([]);
  });
});

describe("canVote", () => {
  test("planned with egress on is votable", () => {
    expect(canVote(entry({ status: "planned", installed: false, enabled: false }), true)).toBe(
      true,
    );
  });
  test("egress off hides the vote affordance entirely", () => {
    expect(canVote(entry({ status: "planned", installed: false, enabled: false }), false)).toBe(
      false,
    );
  });
  test("non-planned entries never show a vote button", () => {
    expect(canVote(entry(), true)).toBe(false);
  });
});

describe("minutesSince", () => {
  test("null for null or unparseable input", () => {
    expect(minutesSince(null, 1000)).toBeNull();
    expect(minutesSince("not a date", 1000)).toBeNull();
  });
  test("floors to whole minutes and clamps future timestamps", () => {
    const now = Date.parse("2026-09-01T12:00:00Z");
    expect(minutesSince("2026-09-01T11:59:30Z", now)).toBe(0);
    expect(minutesSince("2026-09-01T11:30:00Z", now)).toBe(30);
    expect(minutesSince("2026-08-31T12:00:00Z", now)).toBe(1440);
    expect(minutesSince("2026-09-01T12:00:01Z", now)).toBe(0);
  });
});

describe("managed deployments", () => {
  test("the upgrade chip becomes a plain unavailable, because the reader is not the operator", () => {
    expect(blockedChipKey("requires_app_upgrade")).toBe("plugins.chip_requires_app_upgrade");
    expect(blockedChipKey("requires_app_upgrade", true)).toBe("plugins.chip_unavailable");
    // Every other reason reads the same either way.
    expect(blockedChipKey("planned", true)).toBe("plugins.chip_planned");
    expect(blockedChipKey("cloud_only", true)).toBe("plugins.chip_cloud_only");
    expect(blockedChipKey("requires_feature", true)).toBe("plugins.chip_requires_feature");
    expect(blockedChipKey(null, true)).toBeNull();
    // not_in_this_build reads the same either way: nobody can act on it.
    expect(blockedChipKey("not_in_this_build")).toBe("plugins.chip_not_in_build");
    expect(blockedChipKey("not_in_this_build", true)).toBe("plugins.chip_not_in_build");
  });

  test("update affordances are hidden on a managed deployment and shown otherwise", () => {
    expect(canShowUpdates(prov({ managed: true }))).toBe(false);
    expect(canShowUpdates(prov({ managed: false }))).toBe(true);
    // An older backend sends no flag at all; self-hosted is the safe reading.
    expect(canShowUpdates(prov({}))).toBe(true);
    expect(canShowUpdates(null)).toBe(true);
  });
});

describe("voteToastKey", () => {
  test("each outcome gets its own message, and unknown falls back to failure", () => {
    expect(voteToastKey("recorded")).toBe("plugins.vote_recorded");
    expect(voteToastKey("already_voted")).toBe("plugins.vote_already");
    expect(voteToastKey("rejected")).toBe("plugins.vote_rejected");
    expect(voteToastKey("off")).toBe("plugins.vote_failed");
    expect(voteToastKey("failed")).toBe("plugins.vote_failed");
  });
});

describe("catalogErrorKey", () => {
  test("maps every code, and falls back rather than rendering a raw key", () => {
    expect(catalogErrorKey("blocked")).toBe("plugins.catalog_error_blocked");
    expect(catalogErrorKey("invalid_schema")).toBe("plugins.catalog_error_invalid");
    expect(catalogErrorKey(null)).toBe("plugins.catalog_error_unknown");
    // A code a newer backend added must not reach the UI as a missing key.
    expect(catalogErrorKey("something_new" as CatalogErrorCode)).toBe(
      "plugins.catalog_error_unknown",
    );
  });
});

describe("footerState", () => {
  test("egress off wins over everything", () => {
    expect(
      footerState(prov({ egressEnabled: false, source: "snapshot", error: "http_error" }), 0),
    ).toEqual({ kind: "off" });
  });
  test("a failed sync on the snapshot path reports the reason", () => {
    expect(footerState(prov({ source: "snapshot", error: "http_error" }), 0)).toEqual({
      kind: "failed",
      reason: "http_error",
    });
  });
  test("a stale cache with a failed refresh is its own state, not a plain sync", () => {
    // Regression: this used to render as "Synced 20 days ago" with the error
    // dropped, so an install whose catalog had been unreachable for weeks
    // looked healthy and the refresh button looked inert.
    expect(
      footerState(
        prov({
          source: "cache",
          syncedAt: "2026-08-12T12:00:00Z",
          error: "unreachable",
        }),
        Date.parse("2026-09-01T12:00:00Z"),
      ),
    ).toEqual({ kind: "stale", ageMinutes: 28800, reason: "unreachable" });
  });

  test("catalogOrigin names the configured host rather than assuming one", () => {
    expect(catalogOrigin(prov({ host: "mirror.internal" }))).toBe("mirror.internal");
    expect(catalogOrigin(prov({ host: null }))).toBeNull();
    expect(catalogOrigin(prov({}))).toBeNull();
  });

  test("a synced catalog reports its age in minutes for both remote and cache", () => {
    const syncedAt = "2026-09-01T10:00:00Z";
    expect(
      footerState(prov({ source: "cache", syncedAt }), Date.parse("2026-09-01T12:00:00Z")),
    ).toEqual({ kind: "synced", ageMinutes: 120 });
    expect(
      footerState(prov({ source: "remote", syncedAt }), Date.parse("2026-09-01T12:00:00Z")).kind,
    ).toBe("synced");
  });
});

describe("blockedChipKey", () => {
  test("maps each blocked reason to its key and null to null", () => {
    expect(blockedChipKey(null)).toBeNull();
    expect(blockedChipKey("planned")).toBe("plugins.chip_planned");
    expect(blockedChipKey("cloud_only")).toBe("plugins.chip_cloud_only");
    expect(blockedChipKey("requires_feature")).toBe("plugins.chip_requires_feature");
    expect(blockedChipKey("requires_app_upgrade")).toBe("plugins.chip_requires_app_upgrade");
  });
});

describe("view preference", () => {
  const real = (globalThis as { localStorage?: unknown }).localStorage;
  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = real;
  });

  test("defaults to grid when localStorage is absent (bun has none)", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadViewPreference()).toBe("grid");
  });

  test("persists list across loads", () => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage();
    saveViewPreference("list");
    expect(loadViewPreference()).toBe("list");
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe("list");
    saveViewPreference("grid");
    expect(loadViewPreference()).toBe("grid");
  });
});
