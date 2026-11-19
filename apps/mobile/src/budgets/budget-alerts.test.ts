import { describe, expect, it } from "vitest";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import type { ReminderScheduler } from "../reminders/scheduler";
import { notifyBudgetAlerts } from "./budget-alerts";
import { createBudget } from "./budgets";

const today = { year: 2026, month: 10, day: 20 };

function scheduler(available: boolean) {
  const shown: { title: string; body: string }[] = [];
  const s: ReminderScheduler = {
    available,
    ensurePermission: async () => true,
    pending: async () => [],
    cancel: async () => undefined,
    schedule: async () => undefined,
    present: async (n) => void shown.push(n),
  };
  return { s, shown };
}

describe("avisos de presupuesto", () => {
  it("muestra el aviso con el porcentaje y sin montos", async () => {
    const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
    await createBudget(
      fx.db,
      { categoryId: "cat", period: "monthly", amount: cop(100_000n), rollover: false },
      today,
      fx.clock,
    );
    await fx.move(cop(-85_000n), local(2026, 10, 19));
    const { s, shown } = scheduler(true);
    const texts = (a: { view: { status: { percent: number } }; level: string }) => ({
      title: a.level,
      body: `${a.view.status.percent} %`,
    });
    expect(await notifyBudgetAlerts(fx.db, s, today, fx.clock, texts)).toBe(1);
    expect(shown).toEqual([{ title: "warning", body: "85 %" }]);
    expect(await notifyBudgetAlerts(fx.db, s, today, fx.clock, texts)).toBe(0);
  });

  it("en la web no muestra nada pero anota el umbral", async () => {
    const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
    await createBudget(
      fx.db,
      { categoryId: null, period: "monthly", amount: cop(1n), rollover: false },
      today,
      fx.clock,
    );
    await fx.move(cop(-5n), local(2026, 10, 19));
    const { s, shown } = scheduler(false);
    expect(
      await notifyBudgetAlerts(fx.db, s, today, fx.clock, () => ({ title: "", body: "" })),
    ).toBe(0);
    expect(shown).toEqual([]);
  });
});
