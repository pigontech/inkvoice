// Settings tab registry. Core tabs stay hardcoded in Settings.tsx; a
// downstream overlay or plugin can register additional tabs here without
// forking Settings.tsx. Registration happens at bootstrap (before first
// render); a registered tab is always shown.

import type { ReactNode } from "react";

export interface SettingsTabSpec {
  id: string;
  /** Translation key for the tab label (consumer is expected to t(label)). */
  label: string;
  /** Content rendered inside the <TabsContent>. */
  content: ReactNode;
  /** When true, hide the floating save-settings button on this tab. */
  hideSave?: boolean;
}

const tabs: SettingsTabSpec[] = [];

export function registerSettingsTab(tab: SettingsTabSpec): void {
  const idx = tabs.findIndex((t) => t.id === tab.id);
  if (idx >= 0) tabs.splice(idx, 1);
  tabs.push(tab);
}

export function getSettingsTabs(): SettingsTabSpec[] {
  return [...tabs];
}

export function isRegisteredTab(id: string): boolean {
  return tabs.some((t) => t.id === id);
}
