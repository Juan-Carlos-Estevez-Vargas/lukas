import { describe, expect, it } from "vitest";
import { local } from "../accounts/card.test-helper";
import { sqlitePreferences } from "../data/preferences";
import { baseMonth, categoryTotals, compareMonths, dailySpending, moneyFlow } from "./advanced";
import { monthKey } from "./reports";
import { setup } from "./reports.test-helper";
import { loadViews, MAX_VIEWS, removeView, saveView } from "./views";

const oct = { year: 2026, month: 10 };
const sep = { year: 2026, month: 9 };

describe("reportes avanzados", () => {
  it("totales por categoría en positivo, también para el ingreso", async () => {
    const fx = await setup();
    const income = await categoryTotals(fx.db, oct, "income", "COP");
    expect(income.map((c) => [c.id, c.amount.amountMinor])).toEqual([
      ["default.salario", 3_000_000_00n],
    ]);
  });

  it("flujo del mes: lo que sobró va a ahorro", async () => {
    const fx = await setup();
    const flow = await moneyFlow(fx.db, oct, "COP");
    expect(flow.expenses.map((c) => c.id)).toEqual(["default.arriendo", "default.mercado"]);
    expect(flow.savings.amountMinor).toBe(1_000_000_00n);
    expect(flow.deficit.amountMinor).toBe(0n);
  });

  it("flujo del mes: si se gastó más que el ingreso, aparece el déficit", async () => {
    const fx = await setup();
    const flow = await moneyFlow(fx.db, { year: 2026, month: 11 }, "COP");
    expect(flow.income).toEqual([]);
    expect(flow.savings.amountMinor).toBe(0n);
    expect(flow.deficit.amountMinor).toBe(40_000_00n);
  });

  it("gasto por día del mes, con los días sin gasto en cero", async () => {
    const fx = await setup();
    const days = await dailySpending(fx.db, oct, "COP");
    expect(days).toHaveLength(31);
    expect(days[4]).toBe(800_000_00n);
    expect(days[5]).toBe(1_200_000_00n);
    expect(days.filter((d) => d > 0n)).toHaveLength(2);
  });

  it("compara octubre contra septiembre por categoría, del mayor cambio al menor", async () => {
    const fx = await setup();
    const cmp = await compareMonths(fx.db, oct, baseMonth(oct, "previous"), "COP");
    expect(monthKey(cmp.before)).toBe("2026-09");
    expect(cmp.totalCurrent.amountMinor).toBe(2_000_000_00n);
    expect(cmp.totalBefore.amountMinor).toBe(500_000_00n);
    expect(
      cmp.categories.map((c) => [
        c.id,
        c.before.amountMinor,
        c.current.amountMinor,
        c.change.amountMinor,
      ]),
    ).toEqual([
      ["default.arriendo", 0n, 1_200_000_00n, 1_200_000_00n],
      ["default.mercado", 500_000_00n, 800_000_00n, 300_000_00n],
    ]);
  });

  it("una categoría que bajó a cero muestra el cambio negativo", async () => {
    const fx = await setup();
    const cmp = await compareMonths(fx.db, { year: 2026, month: 11 }, oct, "COP");
    expect(cmp.categories.map((c) => [c.id, c.change.amountMinor])).toEqual([
      ["default.arriendo", -1_200_000_00n],
      ["default.mercado", -800_000_00n],
      ["default.transporte", 40_000_00n],
    ]);
  });

  it("el mes base es el anterior o el mismo del año pasado", () => {
    expect(monthKey(baseMonth({ year: 2026, month: 1 }, "previous"))).toBe("2025-12");
    expect(monthKey(baseMonth(oct, "lastYear"))).toBe("2025-10");
    expect(monthKey(baseMonth(sep, "previous"))).toBe("2026-08");
  });

  it("no mezcla fechas fuera del mes", async () => {
    const fx = await setup();
    const days = await dailySpending(fx.db, sep, "COP");
    expect(days[local(2026, 9, 10).getDate() - 1]).toBe(500_000_00n);
    expect(days).toHaveLength(30);
  });
});

describe("vistas guardadas", () => {
  let n = 0;
  const id = () => `v${++n}`;

  it("guarda, reemplaza la igual, borra y tolera basura", async () => {
    const fx = await setup();
    const prefs = sqlitePreferences(fx.db);
    expect(await loadViews(prefs)).toEqual([]);
    await saveView(prefs, { name: " Vs. anterior ", base: "previous", categoryId: null }, id);
    await saveView(
      prefs,
      { name: "Mercado año", base: "lastYear", categoryId: "default.mercado" },
      id,
    );
    const views = await saveView(
      prefs,
      { name: "Mes a mes", base: "previous", categoryId: null },
      id,
    );
    expect(views.map((v) => v.name)).toEqual(["Mes a mes", "Mercado año"]);
    expect(
      await saveView(prefs, { name: "  ", base: "previous", categoryId: null }, id),
    ).toHaveLength(2);
    const left = await removeView(prefs, views[1]?.id ?? "");
    expect(left.map((v) => v.name)).toEqual(["Mes a mes"]);

    await prefs.set("reports.views", "{no es json");
    expect(await loadViews(prefs)).toEqual([]);
    await prefs.set(
      "reports.views",
      JSON.stringify([
        { id: "x", name: "ok", base: "previous", categoryId: null },
        { id: 1 },
        null,
      ]),
    );
    expect((await loadViews(prefs)).map((v) => v.id)).toEqual(["x"]);
    await prefs.set("reports.views", JSON.stringify({ a: 1 }));
    expect(await loadViews(prefs)).toEqual([]);
  });

  it("se queda con las más recientes", async () => {
    const fx = await setup();
    const prefs = sqlitePreferences(fx.db);
    for (let i = 0; i < MAX_VIEWS + 2; i++) {
      await saveView(prefs, { name: `v${i}`, base: "previous", categoryId: `c${i}` }, id);
    }
    const views = await loadViews(prefs);
    expect(views).toHaveLength(MAX_VIEWS);
    expect(views[0]?.name).toBe(`v${MAX_VIEWS + 1}`);
  });
});
