import { en } from "./en";
import { es, type MessageKey, type Messages } from "./es";

export type Locale = "es" | "en";

const catalogs: Record<Locale, Messages> = { es, en };

/** Elige el idioma a partir de las preferencias del dispositivo (BCP 47); por defecto español. */
export const resolveLocale = (preferred: readonly (string | null | undefined)[]): Locale => {
  for (const tag of preferred) {
    const language = tag?.toLowerCase().split("-")[0];
    if (language === "es" || language === "en") return language;
  }
  return "es";
};

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Traductor con interpolación `{nombre}`. Un parámetro faltante deja el marcador visible. */
export const createTranslator =
  (locale: Locale): Translate =>
  (key, params) =>
    catalogs[locale][key].replace(/\{(\w+)\}/g, (match, name: string) =>
      params && name in params ? String(params[name]) : match,
    );
