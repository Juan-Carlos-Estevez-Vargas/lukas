import type { CivilDate, Recurrence } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { createFromTemplate } from "../accounts/accounts";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import { templateByKey } from "../accounts/templates";
import { recordMovement } from "../movements/movements";
import { civilKey, createRecurring, postOccurrence } from "../recurring/recurring";
import {
  atRisk,
  firstNegative,
  lowest,
  projectAccounts,
  projectBalance,
  todayCivil,
  toWholeUnits,
} from "./projection";

const d = (year: number, month: number, day: number): CivilDate => ({ year, month, day });
const monthly = (startsOn: CivilDate): Recurrence => ({
  frequency: "monthly",
  every: 1,
  startsOn,
  endsOn: null,
});
const today = d(2026, 11, 20);

describe("proyección (cálculo)", () => {
  it("suma lo programado en su fecha y el promedio variable día a día", () => {
    const points = projectBalance(
      1000n,
      today,
      5,
      [
        { date: d(2026, 11, 22), amount: -300n, name: "Arriendo" },
        { date: d(2026, 11, 19), amount: -50n, name: "Pendiente" },
      ],
      { total: -100n, days: 10 },
    );
    expect(points.map((p) => p.balance)).toEqual([950n, 940n, 630n, 620n, 610n, 600n]);
    expect(civilKey(points[5]?.date ?? today)).toBe("2026-11-25");
  });

  it("encuentra el primer día en rojo y el más bajo", () => {
    const points = projectBalance(
      100n,
      today,
      4,
      [{ date: d(2026, 11, 22), amount: -150n, name: "x" }],
      {
        total: 30n,
        days: 3,
      },
    );
    expect(points.map((p) => p.balance)).toEqual([100n, 110n, -30n, -20n, -10n]);
    expect(civilKey(firstNegative(points)?.date ?? today)).toBe("2026-11-22");
    expect(lowest(points)?.balance).toBe(-30n);
    expect(firstNegative(projectBalance(5n, today, 3, [], { total: 0n, days: 0 }))).toBeNull();
    expect(lowest([])).toBeNull();
  });

  it("el promedio se muestra en unidades enteras", () => {
    expect(toWholeUnits(-466_666n, "COP")).toBe(-466_700n);
    expect(toWholeUnits(466_649n, "COP")).toBe(466_600n);
    expect(toWholeUnits(150n, "USD")).toBe(200n);
  });

  it("hoy es la fecha del teléfono", () => {
    expect(todayCivil(local(2026, 11, 20, 23))).toEqual(today);
  });
});

async function setup(rentPesos: bigint) {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const tpl = templateByKey("nequi");
  if (!tpl) throw new Error("falta Nequi");
  const nequi = await createFromTemplate(fx.db, tpl, { openingBalance: cop(2_000_000n) }, fx.clock);
  if (!nequi.ok) throw nequi.error;
  const accountId = nequi.value.id;
  const recurring = async (
    name: string,
    kind: "expense" | "income",
    pesos: bigint,
    starts: CivilDate,
    autoPost: boolean,
    createdOn: CivilDate = today,
  ) => {
    const res = await createRecurring(
      fx.db,
      {
        name,
        kind,
        accountId,
        categoryId: kind === "income" ? "default.salario" : "default.arriendo",
        amount: cop(pesos),
        recurrence: monthly(starts),
        autoPost,
        remind: false,
      },
      createdOn,
      fx.clock,
    );
    if (!res.ok) throw res.error;
    return res.value;
  };
  await recurring("Salario", "income", 3_000_000n, d(2026, 11, 30), true);
  await recurring("Arriendo", "expense", rentPesos, d(2026, 12, 5), true);
  // Variable: $500.000 de mercado en los últimos 50 días (la cuenta es del 1 de octubre).
  const res = await recordMovement(
    fx.db,
    {
      kind: "expense",
      accountId,
      categoryId: "default.mercado",
      amount: cop(500_000n),
      occurredAt: local(2026, 11, 10),
    },
    fx.clock,
  );
  if (!res.ok) throw res.error;
  return { ...fx, accountId, recurring };
}

describe("proyección por cuenta", () => {
  it("proyecta Nequi con recurrentes y el promedio, sin tocar la tarjeta", async () => {
    const fx = await setup(2_500_000n);
    const [p, ...rest] = await projectAccounts(fx.db, today);
    expect(rest).toEqual([]);
    expect(p?.name).toBe("Nequi");
    expect(p?.today.amountMinor).toBe(1_500_000_00n);
    // −$500.000 en 50 días = −$10.000 por día.
    expect(p?.dailyAverage.amountMinor).toBe(-10_000_00n);
    expect(p?.points).toHaveLength(91);
    const on = (day: CivilDate) =>
      p?.points.find((x) => civilKey(x.date) === civilKey(day))?.balance;
    expect(on(d(2026, 11, 30))).toBe(4_400_000_00n);
    expect(on(d(2026, 12, 5))).toBe(1_850_000_00n);
    expect(p?.scheduled.map((s) => `${civilKey(s.date)} ${s.name}`)).toEqual([
      "2026-11-30 Salario",
      "2026-12-05 Arriendo",
      "2026-12-30 Salario",
      "2027-01-05 Arriendo",
      "2027-01-30 Salario",
      "2027-02-05 Arriendo",
    ]);
    expect(p?.firstNegative).toBeNull();
  });

  it("avisa el día en que la cuenta quedaría en rojo", async () => {
    const fx = await setup(5_000_000n);
    const all = await projectAccounts(fx.db, today);
    const risky = atRisk(all);
    expect(risky.map((r) => r.name)).toEqual(["Nequi"]);
    expect(civilKey(risky[0]?.firstNegative?.date ?? today)).toBe("2026-12-05");
    expect(risky[0]?.firstNegative?.balance).toBe(-650_000_00n);
  });

  it("lo pendiente de confirmar cuenta hoy y lo ya registrado no infla el promedio", async () => {
    const fx = await setup(2_500_000n);
    // Creado antes de empezar, para que octubre y noviembre queden por confirmar.
    const gym = await fx.recurring(
      "Gimnasio",
      "expense",
      100_000n,
      d(2026, 10, 15),
      false,
      d(2026, 10, 14),
    );
    const posted = await postOccurrence(fx.db, gym, d(2026, 10, 15), fx.clock);
    expect(posted).not.toBeNull();
    const [p] = await projectAccounts(fx.db, today);
    // El gimnasio de octubre ya salió del saldo pero no cuenta como gasto variable.
    expect(p?.today.amountMinor).toBe(1_400_000_00n);
    expect(p?.dailyAverage.amountMinor).toBe(-10_000_00n);
    // Noviembre (15) sigue pendiente: cuenta hoy.
    expect(p?.points[0]?.balance).toBe(1_300_000_00n);
    expect(p?.scheduled[0]).toMatchObject({ name: "Gimnasio", amount: -100_000_00n });
  });

  it("una cuenta archivada o sin nada no avisa", async () => {
    const fx = await setup(2_500_000n);
    await fx.db.run(
      "UPDATE accounts SET archived_at = '2026-11-01T00:00:00Z' WHERE id = ?",
      fx.accountId,
    );
    expect(await projectAccounts(fx.db, today)).toEqual([]);
    expect(atRisk([])).toEqual([]);
  });
});
