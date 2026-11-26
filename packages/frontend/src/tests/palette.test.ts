// The stored palette is user-editable localStorage, so anything unknown must
// land on the default palette instead of an unstyled page.

import { describe, expect, test } from "bun:test";
import { normalizePalette, PALETTES } from "@/hooks/use-palette";

describe("normalizePalette", () => {
  test("keeps every known palette", () => {
    for (const p of PALETTES) expect(normalizePalette(p.id)).toBe(p.id);
  });

  test("falls back to the default palette", () => {
    expect(normalizePalette(null)).toBe("default");
    expect(normalizePalette(undefined)).toBe("default");
    expect(normalizePalette("")).toBe("default");
    expect(normalizePalette("neon")).toBe("default");
    expect(normalizePalette(42)).toBe("default");
  });
});
