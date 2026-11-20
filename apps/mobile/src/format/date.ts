import type { CivilDate } from "@lukas/domain";

/** "2 de diciembre" / "December 2": fecha de calendario sin año, para corte y pago. */
export function formatCivilDate(date: CivilDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(date.year, date.month - 1, date.day)),
  );
}

/** "oct" / "Oct" (corto) u "octubre de 2026" (largo) para un mes del calendario. */
export function formatMonth(
  m: { readonly year: number; readonly month: number },
  locale: string,
  style: "short" | "long" = "short",
): string {
  const options: Intl.DateTimeFormatOptions =
    style === "short"
      ? { month: "short", timeZone: "UTC" }
      : { month: "long", year: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat(locale, options)
    .format(new Date(Date.UTC(m.year, m.month - 1, 1)))
    .replace(".", "");
}

/** "30 nov" / "Nov 30": para las etiquetas de un eje con días. */
export function formatShortDate(date: CivilDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(date.year, date.month - 1, date.day)))
    .replace(" de ", " ")
    .replace(".", "");
}
