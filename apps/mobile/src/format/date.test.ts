import { describe, expect, it } from "vitest";
import { formatCivilDate } from "./date";

describe("formatCivilDate", () => {
  it("muestra día y mes sin que la zona horaria lo corra", () => {
    const d = { year: 2026, month: 12, day: 2 };
    expect(formatCivilDate(d, "es-CO")).toBe("2 de diciembre");
    expect(formatCivilDate(d, "en-US")).toBe("December 2");
  });
});
