import type { CivilDate } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { createFromTemplate } from "../accounts/accounts";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import { templateByKey } from "../accounts/templates";
import { createBudget } from "../budgets/budgets";
import { recordMovement } from "../movements/movements";
import { createRecurring } from "../recurring/recurring";
import { monthAvailable, topCategories, upcomingPayments } from "./home";

const d = (year: number, month: number, day: number): CivilDate => ({ year, month, day });
const today = d(2026, 11, 21);

async function setup() {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const tpl = templateByKey("nequi");
  if (!tpl) throw new Error("falta Nequi");
  const nequi = await createFromTemplate(fx.db, tpl, {}, fx.clock);
  if (!nequi.ok) throw nequi.error;
  const add = async (
    pesos: bigint,
    at: Date,
    categoryId: string,
    kind: "expense" | "income" = "expense",
  ) => {
    const res = await recordMovement(
      fx.db,
      { kind, accountId: nequi.value.id, categoryId, amount: cop(pesos), occurredAt: at },
      fx.clock,
    );
    if (!res.ok) throw res.error;
  };
  return { ...fx, nequi: nequi.value, add };
}

describe("inicio", () => {
  it("disponible del mes: ingresos menos gastos y cuánto por día", async () => {
    const fx = await setup();
    await fx.add(3_000_000n, local(2026, 11, 1), "default.salario", "income");
    await fx.add(1_000_000n, local(2026, 11, 2), "default.arriendo");
    await fx.add(999_999n, local(2026, 10, 30), "default.mercado");
    const m = await monthAvailable(fx.db, today, "COP");
    expect(m).toMatchObject({ source: "cashflow", daysLeft: 10 });
    expect(m.income).toEqual(cop(3_000_000n));
    expect(m.expenses).toEqual(cop(1_000_000n));
    expect(m.available).toEqual(cop(2_000_000n));
    expect(m.perDay).toEqual(cop(200_000n));
  });

  it("con presupuesto general del mes, el disponible es lo que queda de él", async () => {
    const fx = await setup();
    await createBudget(
      fx.db,
      { categoryId: null, period: "monthly", amount: cop(1_000_000n), rollover: false },
      today,
      fx.clock,
    );
    await fx.add(1_200_000n, local(2026, 11, 5), "default.mercado");
    const m = await monthAvailable(fx.db, d(2026, 11, 30), "COP");
    expect(m.source).toBe("budget");
    expect(m.available).toEqual(cop(-200_000n));
    expect(m.perDay.isZero()).toBe(true);
    expect(m.daysLeft).toBe(1);
  });

  it("top de categorías suma subcategorías a su principal", async () => {
    const fx = await setup();
    await fx.db.run(
      `INSERT INTO categories (id, parent_id, name, kind, created_at, updated_at)
       VALUES ('aseo', 'default.mercado', 'Aseo', 'expense', '2026-01-01', '2026-01-01')`,
    );
    await fx.add(300_000n, local(2026, 11, 3), "default.mercado");
    await fx.add(250_000n, local(2026, 11, 4), "aseo");
    await fx.add(400_000n, local(2026, 11, 5), "default.restaurantes");
    await fx.add(100_000n, local(2026, 11, 6), "default.transporte");
    await fx.add(50_000n, local(2026, 11, 7), "default.salud");
    const top = await topCategories(fx.db, today, "COP");
    expect(top.map((c) => [c.name, c.spent])).toEqual([
      ["Mercado", cop(550_000n)],
      ["Restaurantes y domicilios", cop(400_000n)],
      ["Transporte", cop(100_000n)],
    ]);
    expect(top[0]?.icon).toBe("🛒");
  });

  it("próximos pagos: recurrentes, pendientes vencidos y tarjetas", async () => {
    const fx = await setup();
    const rent = {
      kind: "expense" as const,
      accountId: fx.nequi.id,
      categoryId: "default.arriendo",
      amount: cop(1_200_000n),
      autoPost: true,
      remind: false,
    };
    const ok = async (r: Parameters<typeof createRecurring>[1], on = d(2026, 11, 1)) => {
      const res = await createRecurring(fx.db, r, on, fx.clock);
      if (!res.ok) throw res.error;
    };
    await ok({
      ...rent,
      name: "Arriendo",
      recurrence: { frequency: "monthly", every: 1, startsOn: d(2026, 12, 5), endsOn: null },
    });
    await ok({
      ...rent,
      name: "Gimnasio",
      autoPost: false,
      amount: cop(90_000n),
      recurrence: { frequency: "monthly", every: 1, startsOn: d(2026, 11, 10), endsOn: null },
    });
    await ok({
      ...rent,
      name: "Seguro anual",
      recurrence: { frequency: "yearly", every: 1, startsOn: d(2027, 6, 1), endsOn: null },
    });
    await ok({
      ...rent,
      name: "Salario",
      kind: "income",
      categoryId: "default.salario",
      recurrence: { frequency: "monthly", every: 1, startsOn: d(2026, 11, 30), endsOn: null },
    });
    // Compra en la tarjeta después del corte del 15: se paga el 2 de enero (fuera de 30 días).
    await fx.move(cop(-80_000n), local(2026, 11, 18));
    // Compra antes del corte: el extracto se paga el 2 de diciembre.
    await fx.move(cop(-50_000n), local(2026, 11, 10));

    const list = await upcomingPayments(fx.db, today, 30, 5);
    expect(list.map((p) => [p.name, p.date, p.overdue])).toEqual([
      ["Gimnasio", d(2026, 11, 10), true],
      ["Visa", d(2026, 12, 2), false],
      ["Arriendo", d(2026, 12, 5), false],
    ]);
    expect(list[1]?.amount).toEqual(cop(50_000n));
    expect(await upcomingPayments(fx.db, today, 30, 1)).toHaveLength(1);
  });

  it("tarjeta sin extracto pendiente: muestra el pago del ciclo abierto si cae dentro", async () => {
    const fx = await setup();
    await fx.move(cop(-70_000n), local(2026, 11, 18));
    const list = await upcomingPayments(fx.db, d(2026, 12, 10), 30);
    expect(list.map((p) => [p.name, p.date])).toEqual([["Visa", d(2027, 1, 2)]]);
    expect(list[0]?.amount).toEqual(cop(70_000n));
    expect(await upcomingPayments(fx.db, d(2026, 11, 20), 30)).toEqual([]);
  });
});
