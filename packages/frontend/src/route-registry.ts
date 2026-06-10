// Route registry for the open-core split.
//
// OSS calls `registerRoute()` from a side-effect module at boot. A downstream
// overlay imports its own registration module which adds overlay-only routes
// (/signup, /verify, /pricing, /ops, payment flows…) without touching App.tsx.
//
// Order of registration controls render order in <Routes>. Overlay
// should register before OSS bulk routes so its public paths win when paths
// could collide.

import type { ReactElement } from "react";

export type RouteScope = "public" | "portal" | "protected" | "admin";

export interface RegisteredRoute {
  path: string;
  element: ReactElement;
  scope: RouteScope;
  /**
   * When true, ProtectedRoute will not redirect to /onboarding even if the
   * onboarding flag is unset. Used by /onboarding itself.
   */
  skipOnboardingCheck?: boolean;
}

const PUBLIC_ROUTES: RegisteredRoute[] = [];
const PORTAL_ROUTES: RegisteredRoute[] = [];
const PROTECTED_ROUTES: RegisteredRoute[] = [];
const ADMIN_ROUTES: RegisteredRoute[] = [];

export function registerRoute(route: RegisteredRoute): void {
  const bucket =
    route.scope === "public"
      ? PUBLIC_ROUTES
      : route.scope === "portal"
        ? PORTAL_ROUTES
        : route.scope === "admin"
          ? ADMIN_ROUTES
          : PROTECTED_ROUTES;
  // Replace existing registration for the same path so overlays can override.
  const idx = bucket.findIndex((r) => r.path === route.path);
  if (idx >= 0) bucket.splice(idx, 1);
  bucket.push(route);
}

export function getRoutes(scope: RouteScope): RegisteredRoute[] {
  switch (scope) {
    case "public":
      return PUBLIC_ROUTES;
    case "portal":
      return PORTAL_ROUTES;
    case "admin":
      return ADMIN_ROUTES;
    case "protected":
      return PROTECTED_ROUTES;
  }
}
