// The Settings locale field updates on every keystroke, so half-typed tags
// reach Intl. They must fall back instead of crashing the page (issue #26).

import { describe, expect, test } from "bun:test";
import { safeLocale } from "@/lib/utils";

describe("safeLocale", () => {
  test("keeps valid tags", () => {
    expect(safeLocale("de-DE")).toBe("de-DE");
    expect(safeLocale("de")).toBe("de");
  });

  test("falls back on empty or half-typed tags", () => {
    for (const tag of [undefined, null, "", " ", "d", "de-", "de-D", "en_US"]) {
      const locale = safeLocale(tag);
      expect(() => new Intl.DateTimeFormat(locale, { month: "long" })).not.toThrow();
    }
    expect(safeLocale("de-")).toBe("en-US");
    expect(safeLocale(null)).toBe("en-US");
  });
});
