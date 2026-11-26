/** Answer of GET /settings/update-check. */
export interface UpdateCheck {
  enabled: boolean;
  current: string;
  latest: string | null;
  update_available: boolean;
  release_url: string;
  checked_at: string | null;
}

export type UpdateIndicator = "available" | "latest" | "none";

/**
 * What the sidebar shows next to the version. "none" covers every case where
 * the answer is unknown (check switched off, not loaded, lookup failed): the
 * plain version is shown then, never a warning.
 */
export function updateIndicator(check: UpdateCheck | null | undefined): UpdateIndicator {
  if (!check?.enabled || !check.latest) return "none";
  return check.update_available ? "available" : "latest";
}
