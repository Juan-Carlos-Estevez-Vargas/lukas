import { describe, expect, it } from "vitest";
import { contrastRatio, luminance } from "./contrast";
import { type ColorTokens, dark, light, themeFor } from "./tokens";

// WCAG 2.2 AA: 4.5 para texto normal.
const AA = 4.5;
const textPairs: [keyof ColorTokens, keyof ColorTokens][] = [
  ["text", "background"],
  ["text", "surface"],
  ["textMuted", "surface"],
  ["textMuted", "background"],
  ["onPrimary", "primary"],
  ["income", "surface"],
  ["expense", "surface"],
  ["warning", "surface"],
];

describe.each([
  ["claro", light],
  ["oscuro", dark],
])("tema %s", (_, colors) => {
  it.each(textPairs)("%s sobre %s cumple contraste AA", (fg, bg) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(AA);
  });
});

describe("contraste", () => {
  it("calcula los extremos", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    expect(luminance("#ffffff")).toBe(1);
  });

  it("rechaza colores mal formados", () => {
    expect(() => luminance("rojo")).toThrow(/Color inválido/);
  });
});

describe("themeFor", () => {
  it("usa el oscuro solo si el sistema lo pide", () => {
    expect(themeFor("dark").colors).toBe(dark);
    expect(themeFor("light").colors).toBe(light);
    expect(themeFor(null).scheme).toBe("light");
  });
});
