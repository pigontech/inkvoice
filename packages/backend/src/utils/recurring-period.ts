// Calendar maths for recurring schedules. Shared with the frontend, which
// imports this file to preview the next runs, so the preview and the
// generator can never disagree. Pure and UTC-only: no Date local fields.

export type RecurringFrequency = "daily" | "weekly" | "monthly" | "yearly";

/** Which service period each generated invoice states:
 *  - previous: the period that ends the day before the run date (in arrears)
 *  - current:  the period that starts on the run date (in advance) */
export const SERVICE_PERIOD_MODES = ["none", "previous", "current"] as const;
export type ServicePeriodMode = (typeof SERVICE_PERIOD_MODES)[number];

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m - 1, d];
}

function fmt(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m, d)).toISOString().split("T")[0];
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** Moves `iso` by `interval` cycles (negative goes back). Months and years
 *  clamp to the last day, so Jan 31 + 1 month is Feb 28, not Mar 3. */
export function advanceDate(iso: string, frequency: string, interval: number): string {
  const [y, m, d] = parts(iso);
  switch (frequency) {
    case "daily":
      return fmt(y, m, d + interval);
    case "weekly":
      return fmt(y, m, d + 7 * interval);
    case "monthly":
    case "yearly": {
      const months = frequency === "monthly" ? interval : 12 * interval;
      const target = new Date(Date.UTC(y, m + months, 1));
      const ty = target.getUTCFullYear();
      const tm = target.getUTCMonth();
      return fmt(ty, tm, Math.min(d, daysInMonth(ty, tm)));
    }
    default:
      return iso;
  }
}

/** The service period an invoice generated on `runDate` covers, or null. A
 *  one-day period (daily, every 1) has start === end: state it as a date. */
export function servicePeriodFor(
  runDate: string,
  frequency: string,
  interval: number,
  mode: ServicePeriodMode,
): { start: string; end: string } | null {
  if (mode === "previous") {
    return {
      start: advanceDate(runDate, frequency, -interval),
      end: advanceDate(runDate, "daily", -1),
    };
  }
  if (mode === "current") {
    return {
      start: runDate,
      end: advanceDate(advanceDate(runDate, frequency, interval), "daily", -1),
    };
  }
  return null;
}
