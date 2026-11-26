import { useEffect } from "react";
import { usePersistentState } from "@/hooks/use-persistent-state";

// A palette is the color theme (the tokens in styles/globals.css). It is
// separate from the light/dark color scheme in use-theme.ts: every palette has
// a light and a dark variant.
export const PALETTES = [
  // `swatch` is [ground, accent], fixed colors that picture the palette in the picker.
  { id: "default", labelKey: "header.palette_default", swatch: ["#f9fafc", "#2571ec"] },
  { id: "highlighter", labelKey: "header.palette_highlighter", swatch: ["#f3f2ef", "#fad622"] },
] as const;

export type Palette = (typeof PALETTES)[number]["id"];

export const PALETTE_STORAGE_KEY = "inkvoice-palette";

/** Anything that is not a known palette is the default one. */
export function normalizePalette(value: unknown): Palette {
  return PALETTES.some((p) => p.id === value) ? (value as Palette) : "default";
}

/** Put the palette on <html>. The default palette is the absence of the attribute. */
export function applyPalette(palette: Palette): void {
  const root = document.documentElement;
  if (palette === "default") root.removeAttribute("data-palette");
  else root.setAttribute("data-palette", palette);
}

/** Apply the stored palette. Called once before the first render so the app
 *  never paints in the other palette first. */
export function initPalette(): void {
  let stored: unknown = null;
  try {
    stored = JSON.parse(localStorage.getItem(PALETTE_STORAGE_KEY) ?? "null");
  } catch {
    // unreadable storage or value: fall through to the default palette
  }
  applyPalette(normalizePalette(stored));
}

export function usePalette() {
  const [stored, setPalette] = usePersistentState<Palette>(PALETTE_STORAGE_KEY, "default");
  const palette = normalizePalette(stored);
  useEffect(() => {
    applyPalette(palette);
  }, [palette]);
  return { palette, setPalette };
}
