import { describe, expect, it } from "vitest";
import {
  annualizedReturnBp,
  isInvestmentKind,
  type Position,
  portfolioSummary,
  positionValue,
  simpleReturnBp,
  simulateCdt,
  validUnits,
} from "./investments";
import { Money } from "./money";

const cop = (pesos: bigint) => Money.ofMinor(pesos * 100n, "COP");
const pos = (over: Partial<Position>): Position => ({
  id: "p",
  name: "Fondo",
  kind: "fund",
  units: "1",
  unitPrice: cop(1_000_000n),
  invested: cop(1_000_000n),
  openedOn: { year: 2025, month: 11, day: 25 },
  ...over,
});
const today = { year: 2026, month: 11, day: 25 };

describe("posiciones", () => {
  it("valor = unidades × precio, con unidades decimales", () => {
    expect(positionValue(pos({ units: "2.5", unitPrice: cop(10_000n) }))).toEqual(cop(25_000n));
    expect(
      positionValue(pos({ units: "0.00350000", unitPrice: cop(400_000_000n) })).amountMinor,
    ).toBe(140_000_000n);
  });

  it("valida unidades y tipos", () => {
    expect(validUnits("12.5")).toBe(true);
    expect(validUnits("0.00000001")).toBe(true);
    expect(validUnits("0.000000001")).toBe(false);
    expect(validUnits("0")).toBe(false);
    expect(validUnits("-1")).toBe(false);
    expect(validUnits("abc")).toBe(false);
    expect(isInvestmentKind("cdt")).toBe(true);
    expect(isInvestmentKind("casa")).toBe(false);
  });
});

describe("rentabilidad", () => {
  it("simple y anual", () => {
    expect(simpleReturnBp(cop(1_000_000n), cop(1_100_000n))).toBe(1000);
    expect(simpleReturnBp(cop(0n), cop(1n))).toBeNull();
    expect(annualizedReturnBp(cop(1_000_000n), cop(1_100_000n), 365)).toBe(1000);
    // 5 % en medio año ≈ 10,25 % E.A.
    expect(annualizedReturnBp(cop(1_000_000n), cop(1_050_000n), 182)).toBeCloseTo(1028, -1);
    expect(annualizedReturnBp(cop(1_000_000n), cop(1_050_000n), 10)).toBeNull();
    expect(annualizedReturnBp(cop(0n), cop(1n), 400)).toBeNull();
  });

  it("resumen del portafolio con asignación que suma 100 %", () => {
    const s = portfolioSummary(
      [
        pos({ id: "a", kind: "cdt", unitPrice: cop(1_100_000n) }),
        pos({
          id: "b",
          kind: "stock",
          units: "10",
          unitPrice: cop(50_000n),
          invested: cop(400_000n),
        }),
        pos({
          id: "c",
          kind: "crypto",
          unitPrice: Money.ofMinor(100n, "USD"),
          invested: Money.ofMinor(100n, "USD"),
        }),
      ],
      "COP",
      today,
    );
    expect(s.invested).toEqual(cop(1_400_000n));
    expect(s.value).toEqual(cop(1_600_000n));
    expect(s.gain).toEqual(cop(200_000n));
    expect(s.returnBp).toBe(1428);
    expect(s.annualBp).toBe(1429);
    expect(s.allocation.map((a) => [a.kind, a.shareBp])).toEqual([
      ["cdt", 6875],
      ["stock", 3125],
    ]);
    expect(s.allocation.reduce((t, a) => t + a.shareBp, 0)).toBe(10_000);
  });

  it("portafolio vacío", () => {
    const s = portfolioSummary([], "COP", today);
    expect(s.value.isZero()).toBe(true);
    expect(s.returnBp).toBeNull();
    expect(s.annualBp).toBeNull();
    expect(s.allocation).toEqual([]);
  });
});

describe("simulador de CDT", () => {
  it("un año al 10 % E.A. con retención del 4 %", () => {
    const r = simulateCdt({ amount: cop(10_000_000n), annualRateBp: 1000, days: 365 });
    expect(r?.interest).toEqual(cop(1_000_000n));
    expect(r?.withholding).toEqual(cop(40_000n));
    expect(r?.net).toEqual(cop(960_000n));
    expect(r?.atMaturity).toEqual(cop(10_960_000n));
  });

  it("plazo corto y retención propia", () => {
    const r = simulateCdt({
      amount: cop(1_000_000n),
      annualRateBp: 1000,
      days: 90,
      withholdingBp: 0,
    });
    expect(r?.withholding.isZero()).toBe(true);
    expect(Number(r?.interest.amountMinor) / 100).toBeCloseTo(23_780, -1);
  });

  it("rechaza datos imposibles", () => {
    expect(simulateCdt({ amount: cop(0n), annualRateBp: 1000, days: 90 })).toBeNull();
    expect(simulateCdt({ amount: cop(1n), annualRateBp: -1, days: 90 })).toBeNull();
    expect(simulateCdt({ amount: cop(1n), annualRateBp: 1000, days: 0 })).toBeNull();
    expect(simulateCdt({ amount: cop(1n), annualRateBp: 1000, days: 1.5 })).toBeNull();
  });
});
