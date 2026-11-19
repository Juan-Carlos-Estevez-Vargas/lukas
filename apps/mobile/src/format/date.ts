import type { CivilDate } from "@lukas/domain";

/** "2 de diciembre" / "December 2": fecha de calendario sin año, para corte y pago. */
export function formatCivilDate(date: CivilDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(date.year, date.month - 1, date.day)),
  );
}
