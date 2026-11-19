import { type CivilDate, Money } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { createFromTemplate } from "../accounts/accounts";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import { templateByKey } from "../accounts/templates";
import { recordMovement } from "../movements/movements";
import {
  archiveBudget,
  type BudgetInput,
  budgetViews,
  checkBudgetAlerts,
  createBudget,
  fiftyThirtyTwenty,
  listBudgets,
  setBudgetGroup,
  spentIn,
  updateBudgetAmount,
} from "./budgets";

const d = (year: number, month: number, day: number): CivilDate => ({ year, month, day });

async function setup() {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const tpl = templateByKey("nequi");
  if (!tpl) throw new Error("falta Nequi");
  const nequi = await createFromTemplate(fx.db, tpl, {}, fx.clock);
  if (!nequi.ok) throw nequi.error;
  const spend = async (
    pesos: bigint,
    at: Date,
    categoryId = "default.mercado",
    kind: "expense" | "income" = "expense",
  ) => {
    const res = await recordMovement(
      fx.db,
      { kind, accountId: nequi.value.id, categoryId, amount: cop(pesos), occurredAt: at },
      fx.clock,
    );
    if (!res.ok) throw res.error;
  };
  const budget = async (input: Partial<BudgetInput> = {}, today = d(2026, 11, 1)) => {
    const res = await createBudget(
      fx.db,
      {
        categoryId: "default.mercado",
        period: "monthly",
        amount: cop(500_000n),
        rollover: false,
        ...input,
      },
      today,
      fx.clock,
    );
    if (!res.ok) throw res.error;
    return res.value;
  };
  return { ...fx, spend, budget };
}

describe("presupuestos", () => {
  it("pasar el 80 % genera un aviso, una sola vez por periodo", async () => {
    const fx = await setup();
    await fx.budget();
    await fx.spend(300_000n, local(2026, 11, 3));
    expect(await checkBudgetAlerts(fx.db, d(2026, 11, 3), fx.clock)).toEqual([]);

    await fx.spend(110_000n, local(2026, 11, 10));
    const [alert] = await checkBudgetAlerts(fx.db, d(2026, 11, 10), fx.clock);
    expect(alert?.level).toBe("warning");
    expect(alert?.view.status.percent).toBe(82);
    expect(alert?.view.category?.name).toBe("Mercado");
    expect(await checkBudgetAlerts(fx.db, d(2026, 11, 11), fx.clock)).toEqual([]);

    await fx.spend(100_000n, local(2026, 11, 20));
    expect((await checkBudgetAlerts(fx.db, d(2026, 11, 20), fx.clock)).map((a) => a.level)).toEqual(
      ["over"],
    );
    // Mes nuevo, contador nuevo.
    expect(await checkBudgetAlerts(fx.db, d(2026, 12, 1), fx.clock)).toEqual([]);
  });

  it("si salta directo del 0 al 120 % avisa solo que se pasó", async () => {
    const fx = await setup();
    await fx.budget();
    await fx.spend(600_000n, local(2026, 11, 3));
    const alerts = await checkBudgetAlerts(fx.db, d(2026, 11, 3), fx.clock);
    expect(alerts.map((a) => a.level)).toEqual(["over"]);
    expect(await checkBudgetAlerts(fx.db, d(2026, 11, 3), fx.clock)).toEqual([]);
  });

  it("incluye subcategorías, descuenta reembolsos y respeta el periodo", async () => {
    const fx = await setup();
    await fx.db.run(
      `INSERT INTO categories (id, parent_id, name, kind, created_at, updated_at)
       VALUES ('aseo', 'default.mercado', 'Aseo', 'expense', '2026-01-01', '2026-01-01')`,
    );
    await fx.spend(100_000n, local(2026, 11, 1, 0));
    await fx.spend(50_000n, local(2026, 11, 30, 23), "aseo");
    await fx.spend(70_000n, local(2026, 10, 31, 23));
    await fx.spend(10_000n, local(2026, 11, 5), "default.restaurantes");
    const nov = { start: d(2026, 11, 1), end: d(2026, 11, 30) };
    expect(await spentIn(fx.db, "default.mercado", nov, "COP")).toEqual(cop(150_000n));
    expect(await spentIn(fx.db, null, nov, "COP")).toEqual(cop(160_000n));
    expect(await spentIn(fx.db, "default.mercado", nov, "USD")).toEqual(Money.zero("USD"));
  });

  it("un sobre acumula lo que sobró del mes anterior", async () => {
    const fx = await setup();
    await fx.budget({ rollover: true, amount: cop(300_000n) }, d(2026, 10, 15));
    await fx.spend(200_000n, local(2026, 10, 20));
    await fx.spend(350_000n, local(2026, 11, 2));
    const [view] = await budgetViews(fx.db, d(2026, 11, 5));
    expect(view?.status.carried).toEqual(cop(100_000n));
    expect(view?.status.available).toEqual(cop(400_000n));
    expect(view?.status.level).toBe("warning");
  });

  it("presupuesto general, orden por porcentaje y cambios", async () => {
    const fx = await setup();
    const general = await fx.budget({ categoryId: null, amount: cop(1_000_000n) });
    const weekly = await fx.budget({ period: "weekly", amount: cop(100_000n) }, d(2026, 11, 19));
    await fx.spend(90_000n, local(2026, 11, 19));
    const views = await budgetViews(fx.db, d(2026, 11, 19));
    expect(views.map((v) => v.budget.id)).toEqual([weekly.id, general.id]);
    expect(views[1]?.category).toBeNull();

    expect((await updateBudgetAmount(fx.db, general.id, cop(0n), fx.clock)).ok).toBe(false);
    await updateBudgetAmount(fx.db, general.id, cop(50_000n), fx.clock);
    expect((await listBudgets(fx.db)).find((b) => b.id === general.id)?.amount).toEqual(
      cop(50_000n),
    );
    await archiveBudget(fx.db, weekly.id, fx.clock);
    expect((await listBudgets(fx.db)).map((b) => b.id)).toEqual([general.id]);
    // Archivado, se puede volver a crear.
    await fx.budget({ period: "weekly" });
  });

  it("valida lo que se crea", async () => {
    const fx = await setup();
    const code = async (input: Partial<BudgetInput>) => {
      const res = await createBudget(
        fx.db,
        {
          categoryId: "default.mercado",
          period: "monthly",
          amount: cop(1n),
          rollover: false,
          ...input,
        },
        d(2026, 11, 1),
        fx.clock,
      );
      return res.ok ? null : res.error.code;
    };
    expect(await code({ amount: cop(0n) })).toBe("invalid_amount");
    expect(await code({ categoryId: "default.salario" })).toBe("invalid_category");
    expect(await code({ categoryId: "nada" })).toBe("invalid_category");
    expect(await code({})).toBeNull();
    expect(await code({})).toBe("budget_exists");
  });

  it("compara el mes con la regla 50/30/20", async () => {
    const fx = await setup();
    await fx.spend(4_000_000n, local(2026, 11, 1), "default.salario", "income");
    await fx.spend(1_500_000n, local(2026, 11, 2), "default.arriendo");
    await fx.spend(600_000n, local(2026, 11, 3), "default.restaurantes");
    await fx.db.run(
      `INSERT INTO categories (id, name, kind, created_at, updated_at)
       VALUES ('cdt', 'CDT', 'expense', '2026-01-01', '2026-01-01'),
              ('mascota', 'Mascota', 'expense', '2026-01-01', '2026-01-01')`,
    );
    await setBudgetGroup(fx.db, "cdt", "savings");
    await fx.spend(300_000n, local(2026, 11, 4), "cdt");
    await fx.spend(100_000n, local(2026, 11, 5), "mascota");
    await fx.spend(999n, local(2026, 10, 5), "default.arriendo");

    const r = await fiftyThirtyTwenty(fx.db, d(2026, 11, 19), "COP");
    expect(r.income).toEqual(cop(4_000_000n));
    expect(r.targets).toEqual({
      needs: cop(2_000_000n),
      wants: cop(1_200_000n),
      savings: cop(800_000n),
    });
    expect(r.actual).toEqual({
      needs: cop(1_500_000n),
      wants: cop(600_000n),
      savings: cop(1_800_000n),
    });
    expect(r.unassigned).toEqual(cop(100_000n));
  });
});
