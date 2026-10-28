import { describe, expect, it } from "vitest";
import { divideRounded, parseDecimal } from "./rounding";

describe("divideRounded", () => {
  it.each([
    [5n, 2n, "half-even", 2n],
    [7n, 2n, "half-even", 4n],
    [-5n, 2n, "half-even", -2n],
    [5n, 2n, "half-up", 3n],
    [-5n, 2n, "half-up", -3n],
    [7n, 3n, "half-up", 2n],
    [8n, 3n, "half-even", 3n],
    [7n, 2n, "floor", 3n],
    [-7n, 2n, "floor", -4n],
    [7n, 2n, "ceil", 4n],
    [-7n, 2n, "ceil", -3n],
    [7n, -2n, "floor", -4n],
    [6n, 3n, "half-even", 2n],
  ] as const)("%s / %s con %s = %s", (n, d, mode, expected) => {
    expect(divideRounded(n, d, mode)).toBe(expected);
  });

  it("falla al dividir por cero", () => {
    expect(() => divideRounded(1n, 0n, "floor")).toThrow(RangeError);
  });
});

describe("parseDecimal", () => {
  it("interpreta decimales exactos", () => {
    expect(parseDecimal("4123.45")).toEqual({ value: 412345n, scale: 2 });
    expect(parseDecimal("-0.5")).toEqual({ value: -5n, scale: 1 });
    expect(parseDecimal(" 12 ")).toEqual({ value: 12n, scale: 0 });
  });

  it("rechaza formatos ambiguos", () => {
    expect(parseDecimal("1e3")).toBeUndefined();
    expect(parseDecimal("1.")).toBeUndefined();
    expect(parseDecimal("")).toBeUndefined();
  });
});
