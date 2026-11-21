import { afterEach, describe, expect, test } from "bun:test";
import type { CatalogPluginEntry, CatalogResponse } from "../plugins/catalog";
import { usePluginsStore } from "../plugins/use-plugins.store";

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

const CATALOG_RESPONSE: CatalogResponse = {
  data: {
    plugins: [
      entry(),
      entry({ id: "acme-sync", installed: false, enabled: false, blockedReason: "cloud_only" }),
      entry({
        id: "planned-one",
        status: "planned",
        installed: false,
        enabled: false,
        blockedReason: "planned",
        votes: 3,
      }),
    ],
    catalog: {
      source: "remote",
      syncedAt: "2026-09-01T00:00:00.000Z",
      error: null,
      egressEnabled: true,
    },
  },
};

const realFetch = globalThis.fetch;
let calls: { url: string; init?: RequestInit }[] = [];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

function stubFetch(routes: [string, unknown, number?][]) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    for (const [match, body, code = 200] of routes) {
      if (url === match || url.endsWith(match)) {
        return Promise.resolve(json(code, body));
      }
    }
    return Promise.resolve(json(404, { success: false, error: "not found" }));
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls = [];
  usePluginsStore.setState({
    enabled: [],
    entries: [],
    provenance: null,
    loaded: false,
    loading: false,
    error: null,
  });
});

describe("plugins store on the catalog endpoint", () => {
  test("refresh fetches /plugins/catalog and derives enabled ids", async () => {
    stubFetch([["/api/v1/plugins/catalog", CATALOG_RESPONSE]]);
    await usePluginsStore.getState().refresh();
    const s = usePluginsStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.error).toBeNull();
    expect(s.entries.map((p) => p.id)).toEqual(["time-tracker", "acme-sync", "planned-one"]);
    expect(s.enabled).toEqual(["time-tracker"]);
    expect(s.provenance?.source).toBe("remote");
    expect(calls[0]?.url).toContain("/api/v1/plugins/catalog");
    expect(calls[0]?.init?.method ?? "GET").toBe("GET");
  });

  test("refresh with force POSTs the refresh endpoint before the GET", async () => {
    stubFetch([
      ["/api/v1/plugins/catalog/refresh", { success: true, data: { source: "remote" } }],
      ["/api/v1/plugins/catalog", CATALOG_RESPONSE],
    ]);
    await usePluginsStore.getState().refresh({ force: true });
    expect(calls.map((c) => c.url.replace("http://localhost", "").split("?")[0])).toEqual([
      "/api/v1/plugins/catalog/refresh",
      "/api/v1/plugins/catalog",
    ]);
    expect(calls[0]?.init?.method).toBe("POST");
  });

  test("a failed refresh marks loaded and records the error, keeping guards honest", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(json(500, { success: false, error: "boom" }))) as unknown as typeof fetch;
    await usePluginsStore.getState().refresh();
    const s = usePluginsStore.getState();
    expect(s.loaded).toBe(true);
    expect(s.error).toBe("boom");
    expect(s.entries).toEqual([]);
    expect(s.enabled).toEqual([]);
  });

  test("setEnabled PUTs /plugins/:id and patches the entry in place", async () => {
    stubFetch([
      ["/api/v1/plugins/catalog", CATALOG_RESPONSE],
      ["/api/v1/plugins/time-tracker", { success: true, data: { enabled: [] } }],
    ]);
    await usePluginsStore.getState().refresh();
    await usePluginsStore.getState().setEnabled("time-tracker", false);
    const s = usePluginsStore.getState();
    expect(s.enabled).toEqual([]);
    expect(s.entries.find((e) => e.id === "time-tracker")?.enabled).toBe(false);
    expect(calls[1]?.init?.method).toBe("PUT");
  });

  test("vote POSTs the id and patches the entry's votes; a failed vote leaves it alone", async () => {
    stubFetch([
      ["/api/v1/plugins/catalog", CATALOG_RESPONSE],
      [
        "/api/v1/plugins/catalog/vote",
        { success: true, data: { count: 9, alreadyVoted: false, status: "recorded" } },
      ],
    ]);
    await usePluginsStore.getState().refresh();
    const outcome = await usePluginsStore.getState().vote("planned-one");
    expect(outcome).toEqual({ count: 9, alreadyVoted: false, status: "recorded" });
    expect(usePluginsStore.getState().entries.find((e) => e.id === "planned-one")?.votes).toBe(9);
    const voteCalls = calls.filter((c) => c.url.endsWith("/plugins/catalog/vote"));
    expect(JSON.parse(String(voteCalls[0]?.init?.body))).toEqual({ id: "planned-one" });

    // A second vote whose request fails reports failure and keeps the old count.
    stubFetch([["/api/v1/plugins/catalog/vote", { success: false, error: "down" }, 500]]);
    const again = await usePluginsStore.getState().vote("planned-one");
    expect(again).toEqual({ count: null, alreadyVoted: false, status: "failed" });
    expect(usePluginsStore.getState().entries.find((e) => e.id === "planned-one")?.votes).toBe(9);
  });

  test("a repeat vote adopts the server count and reports already_voted", async () => {
    stubFetch([
      ["/api/v1/plugins/catalog", CATALOG_RESPONSE],
      [
        "/api/v1/plugins/catalog/vote",
        { success: true, data: { count: 4, alreadyVoted: true, status: "already_voted" } },
      ],
    ]);
    await usePluginsStore.getState().refresh();
    const outcome = await usePluginsStore.getState().vote("planned-one");
    expect(outcome.status).toBe("already_voted");
    // The count is authoritative even when nothing was written, so the tab
    // shows the real number rather than an optimistic increment.
    expect(usePluginsStore.getState().entries.find((e) => e.id === "planned-one")?.votes).toBe(4);
  });

  test("turnOn restores the backend's published default, so off is not a dead end", async () => {
    stubFetch([
      [
        "/api/v1/plugins/catalog",
        {
          data: {
            plugins: [entry()],
            catalog: {
              source: "snapshot",
              syncedAt: null,
              error: null,
              egressEnabled: false,
              defaultUrl: "https://inkvoice.app/plugins/catalog.v1.json",
            },
          },
        },
      ],
      ["/api/v1/settings", { success: true, data: {} }],
    ]);
    await usePluginsStore.getState().refresh();
    await usePluginsStore.getState().turnOn();

    const settingsCall = calls.find((c) => c.url.endsWith("/settings"));
    expect(JSON.parse(String(settingsCall?.init?.body))).toEqual({
      plugin_catalog_url: "https://inkvoice.app/plugins/catalog.v1.json",
    });
  });

  test("turnOff clears plugin_catalog_url then refetches the snapshot state", async () => {
    stubFetch([
      ["/api/v1/settings", { success: true, data: {} }],
      [
        "/api/v1/plugins/catalog",
        {
          data: {
            plugins: [entry()],
            catalog: { source: "snapshot", syncedAt: null, error: null, egressEnabled: false },
          },
        },
      ],
    ]);
    await usePluginsStore.getState().turnOff();
    const putCall = calls.find((c) => c.url.endsWith("/api/v1/settings"));
    expect(putCall?.init?.method).toBe("PUT");
    expect(JSON.parse(String(putCall?.init?.body))).toEqual({ plugin_catalog_url: "" });
    const s = usePluginsStore.getState();
    expect(s.provenance?.egressEnabled).toBe(false);
    expect(s.provenance?.source).toBe("snapshot");
  });
});
