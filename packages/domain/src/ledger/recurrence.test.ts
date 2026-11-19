import { describe, expect, it } from "vitest";
import {
  addDays,
  isValidCivil,
  nextOccurrence,
  nthOccurrence,
  occurrencesBetween,
  type Recurrence,
  validateRecurrence,
} from "./recurrence";

const d = (year: number, month: number, day: number) => ({ year, month, day });
const monthly = (day: number, extra: Partial<Recurrence> = {}): Recurrence => ({
  frequency: "monthly",
  every: 1,
  startsOn: d(2026, 1, day),
  endsOn: null,
  ...extra,
});

describe("recurrencias", () => {
  it("el arriendo del 31 se ajusta a meses cortos y vuelve al 31", () => {
    const r = monthly(31);
    expect([1, 2, 3, 4].map((n) => nthOccurrence(r, n))).toEqual([
      d(2026, 2, 28),
      d(2026, 3, 31),
      d(2026, 4, 30),
      d(2026, 5, 31),
    ]);
  });

  it("diarias, semanales cada 2 y anuales en bisiesto", () => {
    expect(nthOccurrence({ ...monthly(30), frequency: "daily", every: 3 }, 1)).toEqual(
      d(2026, 2, 2),
    );
    expect(nthOccurrence({ ...monthly(1), frequency: "weekly", every: 2 }, 2)).toEqual(
      d(2026, 1, 29),
    );
    const leap: Recurrence = {
      frequency: "yearly",
      every: 1,
      startsOn: d(2028, 2, 29),
      endsOn: null,
    };
    expect(nthOccurrence(leap, 1)).toEqual(d(2029, 2, 28));
    expect(nthOccurrence(leap, 4)).toEqual(d(2032, 2, 29));
  });

  it("lista las ocurrencias pendientes después de la última generada", () => {
    const r = monthly(5);
    expect(occurrencesBetween(r, null, d(2026, 3, 4))).toEqual([d(2026, 1, 5), d(2026, 2, 5)]);
    expect(occurrencesBetween(r, d(2026, 2, 5), d(2026, 4, 5))).toEqual([
      d(2026, 3, 5),
      d(2026, 4, 5),
    ]);
    expect(occurrencesBetween(r, d(2026, 4, 5), d(2026, 4, 30))).toEqual([]);
  });

  it("salta directo cerca de la última generada aunque la regla sea vieja", () => {
    const r: Recurrence = { frequency: "daily", every: 1, startsOn: d(2000, 1, 1), endsOn: null };
    expect(occurrencesBetween(r, d(2026, 1, 1), d(2026, 1, 3))).toEqual([
      d(2026, 1, 2),
      d(2026, 1, 3),
    ]);
  });

  it("respeta la fecha final y el límite", () => {
    const r = monthly(10, { endsOn: d(2026, 3, 10) });
    expect(occurrencesBetween(r, null, d(2027, 1, 1))).toHaveLength(3);
    expect(occurrencesBetween(r, null, d(2027, 1, 1), 2)).toHaveLength(2);
  });

  it("calcula la siguiente ocurrencia desde una fecha", () => {
    const r = monthly(15);
    expect(nextOccurrence(r, d(2026, 3, 15))).toEqual(d(2026, 3, 15));
    expect(nextOccurrence(r, d(2026, 3, 16))).toEqual(d(2026, 4, 15));
    expect(nextOccurrence(r, d(2025, 6, 1))).toEqual(d(2026, 1, 15));
    expect(nextOccurrence(monthly(15, { endsOn: d(2026, 2, 15) }), d(2026, 2, 16))).toBeNull();
  });

  it("valida la regla", () => {
    expect(validateRecurrence(monthly(1)).ok).toBe(true);
    const code = (r: Recurrence) => {
      const res = validateRecurrence(r);
      return res.ok ? null : res.error.code;
    };
    expect(code(monthly(1, { every: 0 }))).toBe("invalid_interval");
    expect(code(monthly(1, { every: 1.5 }))).toBe("invalid_interval");
    expect(code(monthly(1, { frequency: "hourly" as never }))).toBe("invalid_frequency");
    expect(code(monthly(1, { startsOn: d(2026, 2, 30) }))).toBe("invalid_date");
    expect(code(monthly(1, { endsOn: d(2026, 13, 1) }))).toBe("invalid_date");
    expect(code(monthly(5, { endsOn: d(2026, 1, 4) }))).toBe("ends_before_start");
  });

  it("fechas civiles", () => {
    expect(isValidCivil(d(2028, 2, 29))).toBe(true);
    expect(isValidCivil(d(2026, 2, 29))).toBe(false);
    expect(isValidCivil(d(1900, 1, 1))).toBe(false);
    expect(addDays(d(2026, 12, 31), 1)).toEqual(d(2027, 1, 1));
  });
});
