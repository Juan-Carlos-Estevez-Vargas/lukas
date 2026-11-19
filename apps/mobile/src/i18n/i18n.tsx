import { getLocales } from "expo-localization";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { createTranslator, type Locale, resolveLocale, type Translate } from "./translator";

interface I18n {
  readonly locale: Locale;
  readonly t: Translate;
}

const I18nContext = createContext<I18n>({ locale: "es", t: createTranslator("es") });

/** Toma el idioma del dispositivo una vez al abrir la app. */
export function I18nProvider({ children }: { readonly children: ReactNode }) {
  const value = useMemo<I18n>(() => {
    const locale = resolveLocale(getLocales().map((l) => l.languageTag));
    return { locale, t: createTranslator(locale) };
  }, []);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = (): I18n => useContext(I18nContext);
