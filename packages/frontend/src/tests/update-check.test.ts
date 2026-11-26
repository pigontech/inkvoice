// The sidebar shows an update state only when the server is sure of it.

import { describe, expect, test } from "bun:test";
import { type UpdateCheck, updateIndicator } from "@/lib/update-check";

const base: UpdateCheck = {
  enabled: true,
  current: "0.3.8",
  latest: "0.3.8",
  update_available: false,
  release_url: "https://github.com/pigontech/inkvoice/releases/latest",
  checked_at: "2026-11-26T09:00:00.000Z",
};

describe("updateIndicator", () => {
  test("up to date", () => {
    expect(updateIndicator(base)).toBe("latest");
  });

  test("update available", () => {
    expect(updateIndicator({ ...base, latest: "0.3.9", update_available: true })).toBe("available");
  });

  test("unknown release shows nothing", () => {
    expect(updateIndicator({ ...base, latest: null })).toBe("none");
  });

  test("a switched-off check shows nothing", () => {
    expect(updateIndicator({ ...base, enabled: false, latest: null })).toBe("none");
  });

  test("not loaded yet shows nothing", () => {
    expect(updateIndicator(null)).toBe("none");
    expect(updateIndicator(undefined)).toBe("none");
  });
});
