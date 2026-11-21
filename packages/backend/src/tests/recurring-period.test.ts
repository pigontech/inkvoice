import { describe, expect, test } from "bun:test";
import { advanceDate, servicePeriodFor } from "../utils/recurring-period";

describe("advanceDate", () => {
  test.each([
    ["2026-01-31", "monthly", 1, "2026-02-28"],
    ["2028-01-31", "monthly", 1, "2028-02-29"],
    ["2026-03-31", "monthly", -1, "2026-02-28"],
    ["2026-12-01", "monthly", 1, "2027-01-01"],
    ["2026-12-01", "monthly", -3, "2026-09-01"],
    ["2028-02-29", "yearly", 1, "2029-02-28"],
    ["2026-12-29", "weekly", 1, "2027-01-05"],
    ["2026-12-31", "daily", 1, "2027-01-01"],
  ] as const)("%s %s %i -> %s", (from, freq, n, expected) => {
    expect(advanceDate(from, freq, n)).toBe(expected);
  });
});

describe("servicePeriodFor", () => {
  test.each([
    ["2026-12-01", "monthly", 1, "previous", "2026-11-01", "2026-11-30"],
    ["2026-12-01", "monthly", 1, "current", "2026-12-01", "2026-12-31"],
    ["2027-01-01", "monthly", 3, "previous", "2026-10-01", "2026-12-31"],
    ["2027-01-01", "monthly", 3, "current", "2027-01-01", "2027-03-31"],
    ["2026-12-15", "monthly", 1, "previous", "2026-11-15", "2026-12-14"],
    ["2026-12-07", "weekly", 1, "previous", "2026-11-30", "2026-12-06"],
    ["2027-01-01", "yearly", 1, "previous", "2026-01-01", "2026-12-31"],
    ["2026-12-02", "daily", 1, "previous", "2026-12-01", "2026-12-01"],
  ] as const)("%s %s x%i %s -> %s..%s", (run, freq, n, mode, start, end) => {
    expect(servicePeriodFor(run, freq, n, mode)).toEqual({ start, end });
  });

  test("none states no period", () => {
    expect(servicePeriodFor("2026-12-01", "monthly", 1, "none")).toBeNull();
  });
});
