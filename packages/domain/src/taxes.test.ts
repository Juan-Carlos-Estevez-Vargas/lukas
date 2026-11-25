import { describe, expect, it } from "vitest";
import { Money } from "./money";
import { declarationCheck, gmfForMonth, type TaxYearFigures, uvtFor, uvtToCop } from "./taxes";

const cop = (pesos: bigint) => Money.ofMinor(pesos * 100n, "COP");
const nothing: TaxYearFigures = {
  grossAssets: cop(0n),
  grossIncome: cop(0n),
  creditCardSpending: cop(0n),
  totalPurchases: cop(0n),
  deposits: cop(0n),
};

describe("UVT", () => {
  it("convierte UVT a pesos y no inventa años", () => {
    expect(uvtFor(2025)).toBe(49_799n);
    expect(uvtFor(1999)).toBeNull();
    expect(uvtToCop(49_799n, 1_400n).equals(cop(69_718_600n))).toBe(true);
  });
});

describe("¿debo declarar renta?", () => {
  it("no, si todo está por debajo de los topes", () => {
    const res = declarationCheck(2025, { ...nothing, grossIncome: cop(30_000_000n) });
    if (!res.ok) throw new Error("año conocido");
    expect(res.mustDeclare).toBe(false);
    expect(res.checks.find((c) => c.criterion === "grossIncome")?.percent).toBe(43);
  });

  it("sí, al igualar 1.400 UVT de ingresos; el patrimonio debe superar 4.500 UVT", () => {
    const income = declarationCheck(2025, { ...nothing, grossIncome: cop(69_718_600n) });
    expect(income).toMatchObject({ ok: true, mustDeclare: true });
    const assetsAtLimit = declarationCheck(2025, { ...nothing, grossAssets: cop(224_095_500n) });
    expect(assetsAtLimit).toMatchObject({ ok: true, mustDeclare: false });
    const assetsOver = declarationCheck(2025, { ...nothing, grossAssets: cop(224_095_501n) });
    expect(assetsOver).toMatchObject({ ok: true, mustDeclare: true });
  });

  it("revisa tarjeta, compras y consignaciones, y corta el porcentaje en 100", () => {
    const res = declarationCheck(2024, {
      ...nothing,
      creditCardSpending: cop(70_000_000n),
      deposits: cop(-5n),
    });
    if (!res.ok) throw new Error("año conocido");
    const card = res.checks.find((c) => c.criterion === "creditCardSpending");
    expect(card).toMatchObject({ exceeds: true, percent: 100 });
    expect(res.checks.find((c) => c.criterion === "deposits")?.percent).toBe(0);
    expect(res.checks).toHaveLength(5);
  });

  it("un año sin UVT conocida no se adivina", () => {
    expect(declarationCheck(2030, nothing)).toEqual({ ok: false, reason: "unknown_year" });
  });
});

describe("4×1000", () => {
  it("cobra 4 por mil sobre lo gravado y lo exento que pase de 350 UVT", () => {
    expect(
      gmfForMonth(2026, { exempt: cop(0n), taxed: cop(1_000_000n) })?.equals(cop(4_000n)),
    ).toBe(true);
    // 350 UVT de 2026 = 18.330.900; 1.669.100 por encima pagan 6.676,40.
    const over = gmfForMonth(2026, { exempt: cop(20_000_000n), taxed: cop(0n) });
    expect(over?.equals(Money.ofMinor(667_640n, "COP"))).toBe(true);
    expect(gmfForMonth(2026, { exempt: cop(5_000_000n), taxed: cop(0n) })?.isZero()).toBe(true);
    expect(gmfForMonth(2026, { exempt: cop(0n), taxed: cop(-1n) })?.isZero()).toBe(true);
    expect(gmfForMonth(2031, { exempt: cop(0n), taxed: cop(1n) })).toBeNull();
  });
});
