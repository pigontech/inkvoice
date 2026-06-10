/**
 * Returns today's date as a `YYYY-MM-DD` string in UTC, suitable for storing in
 * SQLite TEXT date columns. Centralizes the repeated `new Date().toISOString().split("T")[0]`
 * pattern across services and routes.
 */
export function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

/** Same as `todayIso` but for any `Date` instance. */
export function toIsoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}
