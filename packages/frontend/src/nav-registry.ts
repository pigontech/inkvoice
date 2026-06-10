// Sidebar nav registry for the open-core / plugin split.
//
// OSS core nav lives directly in Sidebar.tsx. Overlays and plugins call
// `registerNavItem()` from a side-effect module at boot (via @/registrations)
// to add their own sidebar entries without touching Sidebar.tsx. Registered
// items render in an "Extensions" section below the core nav.
//
// Items carrying a `pluginId` are visibility-gated: the overlay installs a gate
// hook (see `setNavGateHook`) that reports whether a plugin is enabled for the
// current tenant. OSS ships an allow-all default so self-hosted plugins always
// show.

import type { ComponentType } from "react";

export interface NavItem {
  /** Router path, e.g. "/time-tracking". Also used as the dedupe key. */
  to: string;
  /** i18n key resolved via t() at render time, e.g. "time_tracker.nav". */
  labelKey: string;
  /** Lucide-style icon component. */
  icon: ComponentType<{ className?: string }>;
  /**
   * i18n key for the sidebar section heading this item groups under.
   * Defaults to "nav.extensions".
   */
  section?: string;
  /** Only render for admins. */
  adminOnly?: boolean;
  /** When set, the nav gate hides this item while the plugin is disabled. */
  pluginId?: string;
}

const NAV_ITEMS: NavItem[] = [];

export function registerNavItem(item: NavItem): void {
  // Replace any existing registration for the same path so overlays can
  // override a core/plugin entry idempotently (HMR-safe).
  const idx = NAV_ITEMS.findIndex((n) => n.to === item.to);
  if (idx >= 0) NAV_ITEMS.splice(idx, 1);
  NAV_ITEMS.push(item);
}

export function getNavItems(): NavItem[] {
  return NAV_ITEMS;
}

// --- Plugin visibility gate -------------------------------------------------
//
// A gate is a React hook returning a predicate `(pluginId) => enabled`. The
// downstream overlay installs one backed by its plugins store; OSS keeps the
// allow-all default. The gate identity is fixed at bootstrap (before the first
// render), so `useNavGate` calling it unconditionally is rules-of-hooks safe.

export type NavGateHook = () => (pluginId: string) => boolean;

let navGateHook: NavGateHook = () => () => true;

export function setNavGateHook(hook: NavGateHook): void {
  navGateHook = hook;
}

export function useNavGate(): (pluginId: string) => boolean {
  return navGateHook();
}
