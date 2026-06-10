/* Inkvoice service worker — minimal app-shell cache for offline read-only browsing. */

const VERSION = "v1";
const SHELL_CACHE = `inkvoice-shell-${VERSION}`;
const ASSET_CACHE = `inkvoice-assets-${VERSION}`;
const SHELL_URLS = ["/", "/index.html", "/favicon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API responses change per-tenant and can mutate at any time — never cache.
  if (url.pathname.startsWith("/api/") || url.pathname === "/health") return;

  // Hashed Vite assets are immutable: cache-first, populate on miss.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Navigation / shell: network-first with cached fallback so the app
  // can still render its login/dashboard skeleton when offline.
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put("/index.html", res.clone()).catch(() => {});
          return res;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const cached = (await cache.match("/index.html")) || (await cache.match("/"));
          return cached || Response.error();
        }
      })(),
    );
  }
});
