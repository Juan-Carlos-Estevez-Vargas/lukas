import { describe, expect, it } from "vitest";
import { formatCivilDate, formatMonth, formatShortDate } from "./date";

describe("formatCivilDate", () => {
  it("muestra día y mes sin que la zona horaria lo corra", () => {
    const d = { year: 2026, month: 12, day: 2 };
    expect(formatCivilDate(d, "es-CO")).toBe("2 de diciembre");
    expect(formatCivilDate(d, "en-US")).toBe("December 2");
  });
});

describe("formatMonth", () => {
  it("corto para los ejes y largo con año para los títulos", () => {
    expect(formatMonth({ year: 2026, month: 10 }, "es-CO")).toBe("oct");
    expect(formatMonth({ year: 2026, month: 10 }, "es-CO", "long")).toBe("octubre de 2026");
    expect(formatMonth({ year: 2026, month: 1 }, "en")).toBe("Jan");
  });
});

describe("formatShortDate", () => {
  it("día y mes corto, sin punto", () => {
    expect(formatShortDate({ year: 2026, month: 11, day: 30 }, "es-CO")).toBe("30 nov");
    expect(formatShortDate({ year: 2026, month: 9, day: 5 }, "en")).toBe("Sep 5");
  });
});
