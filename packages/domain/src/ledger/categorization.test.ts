import { describe, expect, it } from "vitest";
import { type CategoryRule, learnFromCorrection, matchRule } from "./categorization";

const at = (day: number) => new Date(Date.UTC(2026, 10, day));
const rule = (
  r: Partial<CategoryRule> & Pick<CategoryRule, "pattern" | "categoryId">,
): CategoryRule => ({
  id: r.pattern,
  match: "merchant",
  source: "user",
  updatedAt: at(1),
  ...r,
});

describe("matchRule", () => {
  it("comercio exacto, sin tildes ni mayúsculas", () => {
    const rules = [rule({ pattern: "Éxito Unicentro", categoryId: "mercado" })];
    expect(matchRule(rules, { merchant: "EXITO unicentro" })?.categoryId).toBe("mercado");
    expect(matchRule(rules, { merchant: "Éxito" })).toBeNull();
    expect(matchRule(rules, { merchant: null })).toBeNull();
  });

  it("palabra clave en el comercio o la nota, por palabra completa", () => {
    const rules = [rule({ pattern: "gym", match: "keyword", categoryId: "salud" })];
    expect(matchRule(rules, { merchant: "Smart Gym Cedritos" })?.categoryId).toBe("salud");
    expect(matchRule(rules, { merchant: "Pago", note: "mensualidad gym" })?.categoryId).toBe(
      "salud",
    );
    expect(matchRule(rules, { merchant: "Gymboree" })).toBeNull();
  });

  it("prioriza persona > aprendida, comercio > palabra, más específica y más reciente", () => {
    const rules = [
      rule({ pattern: "rappi", match: "keyword", categoryId: "a", source: "learned" }),
      rule({ pattern: "rappi", match: "merchant", categoryId: "b", source: "learned" }),
      rule({ pattern: "rappi", match: "keyword", categoryId: "c" }),
    ];
    expect(matchRule(rules, { merchant: "Rappi" })?.categoryId).toBe("c");
    expect(matchRule(rules.slice(0, 2), { merchant: "Rappi" })?.categoryId).toBe("b");
    const words = [
      rule({ pattern: "rappi", match: "keyword", categoryId: "comida" }),
      rule({ pattern: "rappi turbo", match: "keyword", categoryId: "mercado" }),
    ];
    expect(matchRule(words, { merchant: "Rappi Turbo" })?.categoryId).toBe("mercado");
    const recent = [
      rule({ pattern: "d1", categoryId: "viejo", source: "learned", updatedAt: at(1) }),
      rule({ pattern: "d1", categoryId: "nuevo", source: "learned", updatedAt: at(5) }),
    ];
    expect(matchRule(recent, { merchant: "D1" })?.categoryId).toBe("nuevo");
    expect(matchRule([rule({ pattern: " ", categoryId: "x" })], { merchant: "" })).toBeNull();
  });
});

describe("learnFromCorrection", () => {
  it("aprende solo si cambió la categoría y hay comercio", () => {
    expect(learnFromCorrection("Éxito", "mercado", "compras")).toEqual({
      pattern: "exito",
      categoryId: "compras",
    });
    expect(learnFromCorrection("Éxito", null, "compras")?.categoryId).toBe("compras");
    expect(learnFromCorrection("Éxito", "mercado", "mercado")).toBeNull();
    expect(learnFromCorrection("  ", "mercado", "compras")).toBeNull();
  });
});
