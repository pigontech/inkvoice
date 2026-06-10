import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
// Overlay bootstrap: registers overlay/plugin routes, nav, slots, settings
// tabs, and i18n at import time (before render). OSS ships an empty stub; an
// overlay overrides @/registrations via the build's overlay resolver.
import "@/registrations";
import App from "./App";
import { I18nProvider } from "./i18n/I18nProvider";

// Optional Sentry wiring — only loads if VITE_SENTRY_DSN is set at build time.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  // Dynamic import so OSS builds without DSN skip the dep entirely.
  import("@sentry/react").then((Sentry) => {
    Sentry.init({
      dsn: sentryDsn,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0,
      beforeSend(event) {
        if (event.user) {
          delete event.user.email;
          delete event.user.username;
        }
        return event;
      },
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);

// Register the PWA service worker only in production builds; the dev server
// hot-reloads modules, and a stale cache there causes more pain than offline
// support is worth.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration is best-effort: failures fall back to normal browsing.
    });
  });
}
