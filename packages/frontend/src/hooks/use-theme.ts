import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "auto";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolvedTheme: "light" | "dark") {
  const root = document.documentElement;
  if (resolvedTheme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

// Theme persists to localStorage as a raw string (not JSON-encoded) for
// backward compatibility with installs that set the value before
// `usePersistentState` existed.
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("theme") as Theme;
    if (stored === "light" || stored === "dark" || stored === "auto") return stored;
    return "auto";
  });

  useEffect(() => {
    localStorage.setItem("theme", theme);

    if (theme === "auto") {
      applyTheme(getSystemTheme());
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches ? "dark" : "light");
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    } else {
      applyTheme(theme);
    }
  }, [theme]);

  return { theme, setTheme };
}
