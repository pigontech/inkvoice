/**
 * Returns today's date as a `YYYY-MM-DD` string in UTC. Used to pre-fill date
 * inputs (`<input type="date">`) and to default form fields on render.
 */
export function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

/** Same as `todayIso` but for any `Date` instance. */
export function toIsoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Formats a `Date` as `YYYY-MM-DD` from its *local* calendar fields. Use for
 * dates built with the local-time constructor (fiscal-year helpers, month
 * boundaries) — `toIsoDate` would shift those across midnight UTC.
 */
export function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Adds `days` to a `YYYY-MM-DD` string and returns the result in the same
 * format. Pure calendar arithmetic in UTC, immune to local-timezone shifts.
 */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().split("T")[0];
}
