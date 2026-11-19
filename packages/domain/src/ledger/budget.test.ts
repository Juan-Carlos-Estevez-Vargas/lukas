import { describe, expect, it } from "vitest";
import { Money } from "../money";
import {
  budgetLevel,
  budgetStatus,
  pendingAlerts,
  percentUsed,
  periodsBetween,
  periodWindow,
  shiftWindow,
  split503020,
  validateBudgetAmount,
} from "./budget";

const d = (year: number, month: number, day: number) => ({ year, month, day });
const cop = (pesos: bigint) => Money.ofMinor(pesos * 100n, "COP");

describe("periodos", () => {
  it("semana de lunes a domingo, mes y año", () => {
    // 19 de noviembre de 2026 es jueves.
    expect(periodWindow("weekly", d(2026, 11, 19))).toEqual({
      start: d(2026, 11, 16),
      end: d(2026, 11, 22),
    });
    expect(periodWindow("weekly", d(2026, 11, 22)).start).toEqual(d(2026, 11, 16));
    expect(periodWindow("monthly", d(2028, 2, 10))).toEqual({
      start: d(2028, 2, 1),
      end: d(2028, 2, 29),
    });
    expect(periodWindow("yearly", d(2026, 6, 1))).toEqual({
      start: d(2026, 1, 1),
      end: d(2026, 12, 31),
    });
  });

  it("se mueve al periodo anterior o siguiente", () => {
    const month = periodWindow("monthly", d(2026, 1, 15));
    expect(shiftWindow("monthly", month, -1).start).toEqual(d(2025, 12, 1));
    expect(shiftWindow("yearly", periodWindow("yearly", d(2026, 1, 1)), 1).end).toEqual(
      d(2027, 12, 31),
    );
    const week = periodWindow("weekly", d(2026, 1, 1));
    expect(shiftWindow("weekly", week, 1).start).toEqual(d(2026, 1, 5));
  });

  it("cuenta periodos completos entre dos fechas", () => {
    expect(periodsBetween("monthly", d(2025, 11, 30), d(2026, 2, 1))).toBe(3);
    expect(periodsBetween("yearly", d(2024, 12, 31), d(2026, 1, 1))).toBe(2);
    expect(periodsBetween("weekly", d(2026, 11, 22), d(2026, 11, 23))).toBe(1);
    expect(periodsBetween("weekly", d(2026, 11, 16), d(2026, 11, 22))).toBe(0);
  });
});

describe("estado del presupuesto", () => {
  it("avisa desde el 80 % y marca excedido al 100 %", () => {
    expect(budgetLevel(cop(79_999n), cop(100_000n))).toBe("ok");
    expect(budgetLevel(cop(80_000n), cop(100_000n))).toBe("warning");
    expect(budgetLevel(cop(100_000n), cop(100_000n))).toBe("over");
    expect(budgetLevel(cop(0n), cop(0n))).toBe("ok");
    expect(budgetLevel(cop(1n), cop(0n))).toBe("over");
    expect(budgetLevel(cop(0n), cop(-5n))).toBe("over");
  });

  it("porcentaje sin decimales", () => {
    expect(percentUsed(cop(1n), cop(3n))).toBe(33);
    expect(percentUsed(cop(5n), cop(0n))).toBe(100);
    expect(percentUsed(cop(0n), cop(0n))).toBe(0);
  });

  it("un presupuesto normal no acumula", () => {
    const s = budgetStatus({ limit: cop(500_000n), spentNow: cop(420_000n) });
    expect(s.carried.isZero()).toBe(true);
    expect(s.remaining).toEqual(cop(80_000n));
    expect(s.percent).toBe(84);
    expect(s.level).toBe("warning");
  });

  it("un sobre pasa lo que sobró y lo que faltó", () => {
    const sobra = budgetStatus({
      limit: cop(300_000n),
      spentNow: cop(300_000n),
      envelope: { periodsBefore: 2, spentBefore: cop(500_000n) },
    });
    expect(sobra.carried).toEqual(cop(100_000n));
    expect(sobra.available).toEqual(cop(400_000n));
    expect(sobra.level).toBe("ok");

    const falta = budgetStatus({
      limit: cop(300_000n),
      spentNow: cop(0n),
      envelope: { periodsBefore: 1, spentBefore: cop(350_000n) },
    });
    expect(falta.available).toEqual(cop(250_000n));
  });

  it("valida el monto", () => {
    expect(validateBudgetAmount(cop(1n)).ok).toBe(true);
    expect(validateBudgetAmount(cop(0n)).ok).toBe(false);
  });
});

describe("50/30/20 y avisos", () => {
  it("reparte el ingreso sin perder pesos", () => {
    const r = split503020(Money.ofMinor(1_000_001n, "COP"));
    expect(r.needs.add(r.wants).add(r.savings)).toEqual(Money.ofMinor(1_000_001n, "COP"));
    expect(r.needs.amountMinor).toBe(500_001n);
    expect(split503020(cop(-5n)).needs.isZero()).toBe(true);
  });

  it("avisa una sola vez por umbral y solo el más alto si salta", () => {
    expect(pendingAlerts("ok", [])).toEqual([]);
    expect(pendingAlerts("warning", [])).toEqual(["warning"]);
    expect(pendingAlerts("warning", ["warning"])).toEqual([]);
    expect(pendingAlerts("over", [])).toEqual(["warning", "over"]);
    expect(pendingAlerts("over", ["warning"])).toEqual(["over"]);
  });
});
