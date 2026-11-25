import { describe, expect, it } from "vitest";
import { cop, local } from "../accounts/card.test-helper";
import { createBudget } from "../budgets/budgets";
import { createConnection } from "../data/connection";
import { migrate } from "../data/migrations";
import { nodeSqlite } from "../data/node-sqlite.test-helper";
import { sqlitePreferences } from "../data/preferences";
import { LOCAL_MIGRATIONS } from "../data/schema";
import { createGoal } from "../goals/goals";
import { recordMovement } from "../movements/movements";
import {
  completeOnboarding,
  ONBOARDING_TEMPLATES,
  removeSampleData,
} from "../onboarding/onboarding";
import {
  hideChecklist,
  markStep,
  markTipSeen,
  readTutorial,
  restartTutorial,
  tutorialProgress,
} from "./tutorial";

const today = { year: 2026, month: 11, day: 25 };

async function onboarded(sampleData: boolean) {
  const node = nodeSqlite();
  node.raw.exec("PRAGMA foreign_keys = ON");
  const db = createConnection(node);
  await migrate(db, LOCAL_MIGRATIONS);
  let n = 0;
  const clock = { newId: () => `id-${++n}`, now: () => local(2026, 11, 25) };
  const template = ONBOARDING_TEMPLATES[0];
  if (!template) throw new Error("sin plantillas");
  const account = await completeOnboarding(
    db,
    { template, openingBalance: cop(100_000n), sampleData },
    clock,
  );
  return { db, clock, account };
}

const doneSteps = async (db: Awaited<ReturnType<typeof onboarded>>["db"], lockOn = false) =>
  (await tutorialProgress(db, { lockOn })).steps.filter((s) => s.done).map((s) => s.step);

describe("primeros pasos", () => {
  it("empieza sin nada hecho: ni el saldo inicial ni los datos de ejemplo cuentan", async () => {
    const { db } = await onboarded(true);
    const progress = await tutorialProgress(db, { lockOn: false });
    expect(progress).toMatchObject({ done: 0, total: 6, next: "movement", visible: true });
    await removeSampleData(db);
    expect(await doneSteps(db)).toEqual([]);
  });

  it("detecta el primer gasto, el presupuesto, la meta y el bloqueo", async () => {
    const { db, clock, account } = await onboarded(false);
    const mov = await recordMovement(
      db,
      {
        kind: "expense",
        accountId: account.id,
        categoryId: "default.mercado",
        amount: cop(20_000n),
        occurredAt: local(2026, 11, 25),
        merchant: null,
        note: null,
        tags: [],
      },
      clock,
    );
    if (!mov.ok) throw mov.error;
    expect(await doneSteps(db)).toEqual(["movement"]);

    await createBudget(
      db,
      { categoryId: "default.mercado", period: "monthly", amount: cop(600_000n), rollover: false },
      today,
      clock,
    );
    await createGoal(
      db,
      {
        name: "Viaje",
        target: cop(1_000_000n),
        targetDate: { year: 2027, month: 6, day: 1 },
        accountId: null,
      },
      today,
      clock,
    );
    expect(await doneSteps(db, true)).toEqual(["movement", "budget", "goal", "lock"]);
    expect((await tutorialProgress(db, { lockOn: true })).next).toBe("recurring");
  });

  it("el respaldo se marca a mano y la lista se oculta al terminar", async () => {
    const { db } = await onboarded(false);
    await markStep(db, "backup");
    await markStep(db, "backup");
    expect((await readTutorial(db)).marked).toEqual(["backup"]);
    for (const step of ["movement", "budget", "goal", "recurring"] as const) {
      await markStep(db, step);
    }
    const progress = await tutorialProgress(db, { lockOn: true });
    expect(progress).toMatchObject({ done: 6, next: null, visible: false });
  });

  it("se puede ocultar y volver a ver, con los consejos de nuevo", async () => {
    const { db } = await onboarded(false);
    await markTipSeen(db, "budgets");
    await markTipSeen(db, "budgets");
    await hideChecklist(db);
    expect(await readTutorial(db)).toEqual({ marked: [], seenTips: ["budgets"], hidden: true });
    expect((await tutorialProgress(db, { lockOn: false })).visible).toBe(false);

    await restartTutorial(db);
    expect(await readTutorial(db)).toEqual({ marked: [], seenTips: [], hidden: false });
  });

  it("un estado dañado cuenta como tutorial nuevo y descarta valores desconocidos", async () => {
    const { db } = await onboarded(false);
    const prefs = sqlitePreferences(db);
    await prefs.set("tutorial.state", "{no es json");
    expect(await readTutorial(db)).toEqual({ marked: [], seenTips: [], hidden: false });
    await prefs.set(
      "tutorial.state",
      JSON.stringify({ marked: ["backup", "hackear"], seenTips: "x", hidden: "sí" }),
    );
    expect(await readTutorial(db)).toEqual({ marked: ["backup"], seenTips: [], hidden: false });
  });
});
