import { describe, expect, it } from "vitest";
import { formatCivilDate, formatMonth } from "./date";

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
