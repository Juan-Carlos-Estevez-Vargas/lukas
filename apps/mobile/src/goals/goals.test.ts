import type { CivilDate } from "@lukas/domain";
import { Money } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { createFromTemplate } from "../accounts/accounts";
import { cardFixture, cop } from "../accounts/card.test-helper";
import { templateByKey } from "../accounts/templates";
import {
  archiveGoal,
  contributeToGoal,
  createGoal,
  type GoalInput,
  goalView,
  goalViews,
} from "./goals";

const d = (year: number, month: number, day: number): CivilDate => ({ year, month, day });
const today = d(2026, 11, 19);

async function setup() {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const tpl = templateByKey("savings");
  if (!tpl) throw new Error("falta Ahorros");
  const savings = await createFromTemplate(fx.db, tpl, { openingBalance: cop(600_000n) }, fx.clock);
  if (!savings.ok) throw savings.error;
  const goal = async (input: Partial<GoalInput> = {}) => {
    const res = await createGoal(
      fx.db,
      {
        name: "Viaje",
        icon: " ✈️ ",
        target: cop(3_000_000n),
        targetDate: d(2027, 4, 30),
        accountId: null,
        ...input,
      },
      today,
      fx.clock,
    );
    if (!res.ok) throw res.error;
    return res.value;
  };
  return { ...fx, savings: savings.value, goal };
}

describe("metas de ahorro", () => {
  it("la meta muestra cuánto apartar por mes", async () => {
    const fx = await setup();
    const g = await fx.goal();
    expect(g.icon).toBe("✈️");
    await contributeToGoal(fx.db, g.id, cop(500_000n), fx.clock);
    const view = await goalView(fx.db, g.id, today);
    expect(view?.progress.monthly).toEqual(cop(416_667n));
    expect(view?.progress.percent).toBe(16);
  });

  it("con cuenta, lo ahorrado es el saldo de la cuenta", async () => {
    const fx = await setup();
    const g = await fx.goal({ accountId: fx.savings.id, targetDate: d(2027, 1, 19) });
    const view = await goalView(fx.db, g.id, today);
    expect(view?.progress.saved).toEqual(cop(600_000n));
    expect(view?.progress.contributionsLeft).toBe(3);
    expect(view?.progress.monthly).toEqual(cop(800_000n));
    const res = await contributeToGoal(fx.db, g.id, cop(1n), fx.clock);
    expect(!res.ok && res.error.code).toBe("goal_has_account");
  });

  it("los retiros no dejan lo ahorrado en negativo", async () => {
    const fx = await setup();
    const g = await fx.goal();
    await contributeToGoal(fx.db, g.id, cop(100n), fx.clock);
    await contributeToGoal(fx.db, g.id, cop(-500n), fx.clock);
    expect((await goalView(fx.db, g.id, today))?.progress.saved.isZero()).toBe(true);
    const bad = async (amount: Money, id = g.id) => {
      const r = await contributeToGoal(fx.db, id, amount, fx.clock);
      return r.ok ? null : r.error.code;
    };
    expect(await bad(cop(0n))).toBe("invalid_amount");
    expect(await bad(Money.ofMinor(1n, "USD"))).toBe("invalid_amount");
    expect(await bad(cop(1n), "nada")).toBe("not_found");
  });

  it("lista por fecha y oculta las archivadas", async () => {
    const fx = await setup();
    const late = await fx.goal({ name: "Carro", targetDate: d(2029, 1, 1) });
    const soon = await fx.goal({ name: "Regalos", targetDate: d(2026, 12, 20), icon: null });
    const old = await fx.goal({ name: "Moto" });
    await archiveGoal(fx.db, old.id, fx.clock);
    expect((await goalViews(fx.db, today)).map((v) => v.goal.id)).toEqual([soon.id, late.id]);
    expect(await goalView(fx.db, "nada", today)).toBeNull();
  });

  it("valida lo que se crea", async () => {
    const fx = await setup();
    const code = async (input: Partial<GoalInput>) => {
      const res = await createGoal(
        fx.db,
        { name: "Meta", target: cop(1n), targetDate: d(2027, 1, 1), accountId: null, ...input },
        today,
        fx.clock,
      );
      return res.ok ? null : res.error.code;
    };
    expect(await code({ name: "" })).toBe("goal_name_required");
    expect(await code({ targetDate: d(2026, 1, 1) })).toBe("goal_date_past");
    expect(await code({ accountId: "nada" })).toBe("account_not_found");
    expect(await code({ accountId: fx.savings.id, target: Money.ofMinor(1n, "USD") })).toBe(
      "currency_mismatch",
    );
  });
});
