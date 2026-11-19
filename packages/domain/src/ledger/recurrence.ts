import { DomainError } from "../errors";
import { err, ok, type Result } from "../result";
import { addMonths, type CivilDate, compareCivil, dayIn } from "./credit-card";

export type Frequency = "daily" | "weekly" | "monthly" | "yearly";
export const FREQUENCIES: readonly Frequency[] = ["daily", "weekly", "monthly", "yearly"];

/** Regla de repetición: cada `every` días, semanas, meses o años desde `startsOn`. */
export interface Recurrence {
  readonly frequency: Frequency;
  readonly every: number;
  readonly startsOn: CivilDate;
  /** Última fecha posible (inclusive); `null` si no termina. */
  readonly endsOn: CivilDate | null;
}

const MAX_EVERY = 365;

export function validateRecurrence(r: Recurrence): Result<Recurrence, DomainError> {
  if (!FREQUENCIES.includes(r.frequency)) {
    return err(new DomainError("invalid_frequency", "Frecuencia desconocida"));
  }
  if (!Number.isInteger(r.every) || r.every < 1 || r.every > MAX_EVERY) {
    return err(new DomainError("invalid_interval", "El intervalo va de 1 a 365"));
  }
  if (!isValidCivil(r.startsOn) || (r.endsOn && !isValidCivil(r.endsOn))) {
    return err(new DomainError("invalid_date", "Fecha inválida"));
  }
  if (r.endsOn && compareCivil(r.endsOn, r.startsOn) < 0) {
    return err(new DomainError("ends_before_start", "La fecha final es anterior a la inicial"));
  }
  return ok(r);
}

export function isValidCivil(d: CivilDate): boolean {
  if (![d.year, d.month, d.day].every(Number.isInteger)) return false;
  if (d.year < 1970 || d.year > 9999 || d.month < 1 || d.month > 12 || d.day < 1) return false;
  return dayIn(d.year, d.month, d.day).day === d.day;
}

export function addDays(d: CivilDate, n: number): CivilDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/**
 * La ocurrencia número `n` (desde 0). Las mensuales y anuales conservan el día de inicio y lo
 * ajustan a meses cortos: el arriendo del 31 cae el 30 en abril y vuelve al 31 en mayo.
 */
export function nthOccurrence(r: Recurrence, n: number): CivilDate {
  const s = r.startsOn;
  switch (r.frequency) {
    case "daily":
      return addDays(s, n * r.every);
    case "weekly":
      return addDays(s, n * r.every * 7);
    case "monthly": {
      const [y, m] = addMonths(s.year, s.month, n * r.every);
      return dayIn(y, m, s.day);
    }
    case "yearly": {
      const [y, m] = addMonths(s.year, s.month, n * r.every * 12);
      return dayIn(y, m, s.day);
    }
  }
}

/** Días aproximados entre ocurrencias, para saltar directo cerca de `after`. */
const approxDays = (r: Recurrence): number =>
  r.every * { daily: 1, weekly: 7, monthly: 31, yearly: 366 }[r.frequency];

const civilDays = (d: CivilDate): number => Date.UTC(d.year, d.month - 1, d.day) / 86_400_000;

/**
 * Ocurrencias posteriores a `after` (exclusivo; `null` = desde el inicio) y hasta `through`
 * (inclusive), sin pasar de `endsOn`. Como mucho `limit`, las más antiguas primero.
 */
export function occurrencesBetween(
  r: Recurrence,
  after: CivilDate | null,
  through: CivilDate,
  limit = 400,
): CivilDate[] {
  const out: CivilDate[] = [];
  const last = r.endsOn && compareCivil(r.endsOn, through) < 0 ? r.endsOn : through;
  // Empezar unas ocurrencias antes de `after` sin recorrer años de historia.
  let n = after
    ? Math.max(0, Math.floor((civilDays(after) - civilDays(r.startsOn)) / approxDays(r)) - 1)
    : 0;
  while (out.length < limit) {
    const d = nthOccurrence(r, n++);
    if (compareCivil(d, last) > 0) break;
    if (!after || compareCivil(d, after) > 0) out.push(d);
  }
  return out;
}

/** Primera ocurrencia en `from` o después; `null` si la regla ya terminó. */
export function nextOccurrence(r: Recurrence, from: CivilDate): CivilDate | null {
  const start = compareCivil(from, r.startsOn) < 0 ? r.startsOn : from;
  const horizon = addDays(start, approxDays(r) + 1);
  return occurrencesBetween(r, addDays(start, -1), horizon, 1)[0] ?? null;
}
