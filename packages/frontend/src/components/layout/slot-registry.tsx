// Named-slot registry for layout injection. A downstream overlay or plugin
// registers components into the OSS shell without forking layout files.
//
// Slots currently exposed:
//   - top-banners       (above the header — status/notice banners)
//   - header-right      (right-side header items — locale switcher addons)
//   - footer-links      (cross-link block in the public/portal footer)
//   - nav-extra         (extra sidebar items below the OSS nav)
//   - login-oauth       (above the login form — alternative sign-in methods)
//   - login-footer      (below the login form — e.g. a sign-up link)
//   - settings-payments (top of the Settings → Payments tab)

import type { ReactNode } from "react";

export type SlotName =
  | "top-banners"
  | "header-right"
  | "footer-links"
  | "nav-extra"
  | "login-oauth"
  | "login-footer"
  | "settings-payments";

const slots: Record<SlotName, ReactNode[]> = {
  "top-banners": [],
  "header-right": [],
  "footer-links": [],
  "nav-extra": [],
  "login-oauth": [],
  "login-footer": [],
  "settings-payments": [],
};

export function registerSlot(name: SlotName, node: ReactNode): void {
  slots[name].push(node);
}

export function Slot({ name }: { name: SlotName }) {
  const entries = slots[name];
  if (entries.length === 0) return null;
  return (
    <>
      {entries.map((node, idx) => (
        <span key={`${name}-${idx}`}>{node}</span>
      ))}
    </>
  );
}
