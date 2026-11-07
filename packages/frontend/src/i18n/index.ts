import { createContext, useContext } from "react";
import de from "./de";
import en, { type TranslationKeys } from "./en";
import enNZ from "./en-NZ";
import es from "./es";
import fr from "./fr";
import tr from "./tr";

export type Language = "en" | "en-NZ" | "tr" | "es" | "de" | "fr";

export const languages: Record<Language, string> = {
  en: "English",
  "en-NZ": "English (New Zealand)",
  tr: "Türkçe",
  es: "Español",
  de: "Deutsch",
  fr: "Français",
};

const translations: Record<Language, TranslationKeys> = { en, "en-NZ": enNZ, tr, es, de, fr };

/**
 * Deep-merge partial translations into a language dictionary at import time.
 *
 * Overlays/plugins call this from the @/registrations bootstrap (before the
 * I18nProvider creates `t`), so merged keys are present on the first render.
 * The merge mutates the existing `translations[lang]` object in place, which
 * matters because `createT` captures that reference — late additions stay
 * visible. `en.ts` remains the type source; partials are typed loosely since
 * plugins only contribute their own namespaces.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const existing = target[key];
      if (!existing || typeof existing !== "object") target[key] = {};
      deepMerge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
}

export function registerTranslations(
  lang: Language,
  partial: DeepPartial<TranslationKeys> & Record<string, unknown>,
): void {
  deepMerge(translations[lang] as unknown as Record<string, unknown>, partial);
}

function getNestedValue(obj: any, path: string): string {
  return path.split(".").reduce((acc, key) => acc?.[key], obj) ?? path;
}

function interpolate(str: string, params?: Record<string, string | number>): string {
  if (!params) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? `{{${key}}}`));
}

export type TFunction = (key: string, params?: Record<string, string | number>) => string;

function createT(lang: Language): TFunction {
  const dict = translations[lang];
  return (key: string, params?: Record<string, string | number>) => {
    let value = getNestedValue(dict, key);
    // en-NZ only overrides tax wording; plugin keys registered for "en" fall through.
    if (value === key && lang === "en-NZ") value = getNestedValue(translations.en, key);
    return interpolate(value, params);
  };
}

const STORAGE_KEY = "inkvoice-lang";

export function getSavedLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in translations) return saved as Language;
  } catch {}
  return "en";
}

export function saveLanguage(lang: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {}
}

export interface I18nContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TFunction;
}

export const I18nContext = createContext<I18nContextValue>({
  language: "en",
  setLanguage: () => {},
  t: createT("en"),
});

export function useTranslation(): I18nContextValue {
  return useContext(I18nContext);
}

export { createT };
