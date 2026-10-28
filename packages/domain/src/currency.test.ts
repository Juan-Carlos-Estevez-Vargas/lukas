import { describe, expect, it } from "vitest";
import { currencyOf, isCurrencyCode } from "./currency";

describe("currency", () => {
  it("reconoce monedas soportadas", () => {
    expect(isCurrencyCode("COP")).toBe(true);
    expect(isCurrencyCode("toString")).toBe(false);
    const cop = currencyOf("COP");
    expect(cop.ok && cop.value.minorUnits).toBe(2);
  });

  it("rechaza monedas desconocidas", () => {
    const result = currencyOf("XYZ");
    expect(!result.ok && result.error.code).toBe("unsupported_currency");
  });
});
