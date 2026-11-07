import { useCallback, useEffect, useMemo, useState } from "react";
import { useSettingsStore } from "@/stores/settings.store";
import { createT, getSavedLanguage, I18nContext, type Language, saveLanguage } from "./index";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLang] = useState<Language>(getSavedLanguage);
  // A New Zealand business gets NZ wording (GST, GST Number, …) for everyone
  // using English, not only for users who pick English (New Zealand).
  const businessLocale = useSettingsStore((s) => s.settings.locale);
  const effectiveLanguage: Language =
    language === "en" && businessLocale === "en-NZ" ? "en-NZ" : language;

  useEffect(() => {
    document.documentElement.lang = effectiveLanguage;
  }, [effectiveLanguage]);

  const setLanguage = useCallback((lang: Language) => {
    setLang(lang);
    saveLanguage(lang);
  }, []);

  const t = useMemo(() => createT(effectiveLanguage), [effectiveLanguage]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
