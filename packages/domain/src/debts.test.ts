import { describe, expect, it } from "vitest";
import { type Debt, freedomMonth, monthlyRateFactor, planDebts, prepaymentSavings } from "./debts";
import { Money } from "./money";

const cop = (pesos: number) => Money.ofMinor(BigInt(pesos) * 100n, "COP");

const card: Debt = {
  id: "tarjeta",
  name: "Tarjeta",
  balance: cop(3_000_000),
  annualRateBp: 2899,
  minPayment: cop(150_000),
};
const loan: Debt = {
  id: "libre",
  name: "Libre inversión",
  balance: cop(8_000_000),
  annualRateBp: 1800,
  minPayment: cop(300_000),
};
const small: Debt = {
  id: "celular",
  name: "Celular",
  balance: cop(600_000),
  annualRateBp: 1200,
  minPayment: cop(60_000),
};

describe("tasa mensual", () => {
  it("convierte la efectiva anual a mensual equivalente", () => {
    expect(monthlyRateFactor(0)).toBe("0.000000000");
    // 12,68 % E.A. ≈ 1 % mensual.
    expect(Number(monthlyRateFactor(1268))).toBeCloseTo(0.01, 4);
    expect(() => monthlyRateFactor(-1)).toThrow(RangeError);
  });
});

describe("plan de deudas", () => {
  it("sin interés, termina en saldo / pago meses exactos", () => {
    const plan = planDebts([{ ...small, annualRateBp: 0 }], cop(100_000), "snowball");
    expect(plan).toMatchObject({ ok: true, months: 6 });
    if (plan.ok) {
      expect(plan.totalInterest.isZero()).toBe(true);
      expect(plan.totalPaid.equals(cop(600_000))).toBe(true);
    }
  });

  it("bola de nieve paga primero la más pequeña; avalancha, la más cara", () => {
    const debts = [loan, card, small];
    const snowball = planDebts(debts, cop(900_000), "snowball");
    const avalanche = planDebts(debts, cop(900_000), "avalanche");
    if (!snowball.ok || !avalanche.ok) throw new Error("debía terminar");
    expect(snowball.payoffs[0]?.id).toBe("celular");
    expect(avalanche.payoffs.map((p) => p.id).indexOf("tarjeta")).toBeLessThan(
      avalanche.payoffs.map((p) => p.id).indexOf("libre"),
    );
    // La avalancha nunca paga más intereses que la bola de nieve.
    expect(avalanche.totalInterest.compare(snowball.totalInterest)).toBeLessThanOrEqual(0);
    expect(avalanche.months).toBeLessThanOrEqual(snowball.months);
    expect(snowball.payoffs).toHaveLength(3);
  });

  it("lo pagado es la deuda más los intereses", () => {
    const plan = planDebts([card, small], cop(500_000), "avalanche");
    if (!plan.ok) throw new Error("debía terminar");
    expect(plan.totalPaid.equals(card.balance.add(small.balance).add(plan.totalInterest))).toBe(
      true,
    );
  });

  it("avisa si el presupuesto no cubre los mínimos o si la deuda nunca baja", () => {
    expect(planDebts([card, loan], cop(400_000), "snowball")).toEqual({
      ok: false,
      reason: "budget_below_minimums",
    });
    const tiny = { ...card, minPayment: cop(10_000) };
    expect(planDebts([tiny], cop(10_000), "snowball")).toEqual({
      ok: false,
      reason: "never_ends",
    });
    expect(planDebts([{ ...small, balance: cop(0) }], cop(1), "snowball")).toEqual({
      ok: false,
      reason: "empty",
    });
  });
});

describe("abonos a capital", () => {
  it("un abono mensual ahorra meses e intereses", () => {
    const res = prepaymentSavings(loan, { monthlyExtra: cop(200_000), lumpSum: cop(0) });
    if (!res.ok) throw new Error("debía terminar");
    expect(res.newMonths).toBeLessThan(res.baseMonths);
    expect(res.monthsSaved).toBe(res.baseMonths - res.newMonths);
    expect(res.interestSaved.isNegative()).toBe(false);
    expect(res.interestSaved.isZero()).toBe(false);
  });

  it("un abono único que cubre la deuda la termina hoy", () => {
    const res = prepaymentSavings(small, { monthlyExtra: cop(0), lumpSum: cop(1_000_000) });
    expect(res).toMatchObject({ ok: true, newMonths: 0 });
  });

  it("si la cuota no alcanza ni para los intereses, lo dice", () => {
    expect(
      prepaymentSavings(
        { ...card, minPayment: cop(1_000) },
        { monthlyExtra: cop(0), lumpSum: cop(0) },
      ),
    ).toEqual({ ok: false, reason: "never_ends" });
  });
});

describe("fecha de libertad", () => {
  it("suma meses cruzando de año", () => {
    expect(freedomMonth({ year: 2026, month: 11 }, 0)).toEqual({ year: 2026, month: 11 });
    expect(freedomMonth({ year: 2026, month: 11 }, 2)).toEqual({ year: 2027, month: 1 });
    expect(freedomMonth({ year: 2026, month: 11 }, 26)).toEqual({ year: 2029, month: 1 });
  });
});
