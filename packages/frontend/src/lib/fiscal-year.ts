/**
 * Compute the start of the fiscal year that contains `date`.
 * `startMonth` is 1-12 (January = 1). When startMonth is 1, this matches
 * the calendar year.
 */
export function startOfFiscalYear(date: Date, startMonth: number): Date {
  const m = date.getMonth(); // 0-11
  const startIdx = clampStartMonth(startMonth) - 1;
  const year = m >= startIdx ? date.getFullYear() : date.getFullYear() - 1;
  return new Date(year, startIdx, 1);
}

export function endOfFiscalYear(date: Date, startMonth: number): Date {
  const start = startOfFiscalYear(date, startMonth);
  // Last instant of the day before the next fiscal year starts.
  return new Date(start.getFullYear() + 1, start.getMonth(), 0, 23, 59, 59, 999);
}

/**
 * Subtract `n` fiscal years from `date`, preserving its position within the FY.
 * `_startMonth` is accepted to mirror the other helpers' signatures, even
 * though shifting by whole years preserves the FY offset automatically.
 */
export function subFiscalYears(date: Date, _startMonth: number, n: number): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() - n);
  return d;
}

export function parseFiscalYearStartMonth(raw: string | undefined): number {
  if (!raw) return 1;
  const n = Number(raw);
  return Number.isFinite(n) ? clampStartMonth(n) : 1;
}

function clampStartMonth(m: number): number {
  if (m < 1) return 1;
  if (m > 12) return 12;
  return Math.floor(m);
}
