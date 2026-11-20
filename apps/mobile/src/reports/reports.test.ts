import { describe, expect, it } from "vitest";
import {
  cashFlow,
  lastMonths,
  monthKey,
  monthRange,
  netWorthSeries,
  parseMonth,
  spendingByCategory,
} from "./reports";
import { setup } from "./reports.test-helper";

describe("meses", () => {
  it("cuenta hacia atrás cruzando el año", () => {
    expect(lastMonths({ year: 2026, month: 2 }, 4).map(monthKey)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("lee el mes de un enlace y rechaza lo que no lo es", () => {
    expect(parseMonth("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth("octubre")).toBeNull();
    expect(parseMonth(undefined)).toBeNull();
  });

  it("el rango del mes va del día 1 al 1 del siguiente", () => {
    expect(monthRange({ year: 2026, month: 12 })).toEqual({
      from: new Date(2026, 11, 1),
      to: new Date(2027, 0, 1),
    });
  });
});

describe("reportes", () => {
  const months = lastMonths({ year: 2026, month: 11 }, 3);

  it("flujo de caja: ingresos y gastos por mes", async () => {
    const fx = await setup();
    const flow = await cashFlow(fx.db, months, "COP");
    expect(
      flow.map((f) => [monthKey(f.month), f.income.amountMinor, f.expenses.amountMinor]),
    ).toEqual([
      ["2026-09", 3_000_000_00n, 500_000_00n],
      ["2026-10", 3_000_000_00n, 2_000_000_00n],
      ["2026-11", 0n, 40_000_00n],
    ]);
  });

  it("por categoría: el gasto del mes de mayor a menor", async () => {
    const fx = await setup();
    const cats = await spendingByCategory(fx.db, { year: 2026, month: 10 }, "COP");
    expect(cats.map((c) => [c.id, c.spent.amountMinor])).toEqual([
      ["default.arriendo", 1_200_000_00n],
      ["default.mercado", 800_000_00n],
    ]);
  });

  it("patrimonio al cierre de cada mes", async () => {
    const fx = await setup();
    const series = await netWorthSeries(fx.db, months, "COP");
    expect(series.map((s) => s.total.amountMinor)).toEqual([
      2_500_000_00n,
      3_500_000_00n,
      3_460_000_00n,
    ]);
  });
});
