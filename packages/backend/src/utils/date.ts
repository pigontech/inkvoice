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

/**
 * Format an ISO date string using the workspace's `date_format` pattern (both
 * `DD.MM.YYYY` from Settings and `dd.MM.yyyy` from onboarding presets) or a
 * per-document/customer `localeOverride`.
 *
 * When `dateFormat` is configured, it wins over `localeOverride` so e.g.
 * `DD.MM.YYYY` renders `26.11.2026` instead of `26. Nov. 2026`.
 */
export function formatDateStr(
  dateStr: string,
  dateFormat?: string,
  localeOverride?: string,
): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const d = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  if (dateFormat) {
    const yyyy = d.getFullYear().toString();
    const mm = (d.getMonth() + 1).toString().padStart(2, "0");
    const dd = d.getDate().toString().padStart(2, "0");
    return dateFormat.replace(/YYYY/gi, yyyy).replace(/MM/g, mm).replace(/DD/gi, dd);
  }
  try {
    return d.toLocaleDateString(localeOverride || "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
}
