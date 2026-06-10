import { useCallback, useEffect, useMemo, useState } from "react";
import { createT, getSavedLanguage, I18nContext, type Language, saveLanguage } from "./index";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLang] = useState<Language>(getSavedLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((lang: Language) => {
    setLang(lang);
    saveLanguage(lang);
  }, []);

  const t = useMemo(() => createT(language), [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
