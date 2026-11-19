import { goalProgress, Money } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { createTranslator } from "../i18n/translator";
import { goalLine } from "./text";

const t = createTranslator("es");
const cop = (pesos: bigint) => Money.ofMinor(pesos * 100n, "COP");
const money = (m: Money) => m.toDecimalString();
const d = (year: number, month: number, day: number) => ({ year, month, day });

describe("texto de la meta", () => {
  it("aporte mensual, último mes, vencida y cumplida", () => {
    const line = (saved: bigint, today: ReturnType<typeof d>, target: ReturnType<typeof d>) =>
      goalLine(goalProgress(cop(1_200n), cop(saved), today, target), t, money);
    expect(line(0n, d(2026, 1, 1), d(2026, 12, 1))).toBe("Aparta 100.00 al mes");
    expect(line(200n, d(2026, 1, 1), d(2026, 1, 20))).toBe("Aparta 1000.00 este mes");
    expect(line(200n, d(2026, 2, 1), d(2026, 1, 20))).toBe("La fecha pasó: faltan 1000.00");
    expect(line(1_200n, d(2026, 2, 1), d(2026, 1, 20))).toBe("¡Meta cumplida!");
  });
});
