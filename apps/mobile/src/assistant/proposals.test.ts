import { describe, expect, it } from "vitest";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import { listBudgets } from "../budgets/budgets";
import { recordMovement } from "../movements/movements";
import { acceptProposal, editTarget, occurredAtOf, proposalAmount } from "./proposals";
import { assistantEnabled, setAssistantEnabled } from "./settings";
import type { Proposal } from "./stream";

const NOW = local(2026, 11, 20, 15);

async function setup() {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const clock = { ...fx.clock, now: () => NOW };
  await fx.db.run(
    `INSERT INTO categories (id, name, kind, is_system, created_at, updated_at)
     VALUES ('ocio', 'Ocio', 'expense', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  );
  const count = async () =>
    (await fx.db.get<{ n: number }>("SELECT count(*) AS n FROM transactions"))?.n ?? 0;
  return { ...fx, clock, count };
}

const movement = (over: Partial<Extract<Proposal, { type: "movement" }>["payload"]> = {}) =>
  ({
    id: "p1",
    type: "movement",
    summary: "Gasto",
    payload: {
      kind: "expense",
      accountId: "",
      categoryId: "cat",
      amount: { amount: "12000.00", currency: "COP" },
      date: "2026-11-19",
      merchant: "Exito",
      note: null,
      ...over,
    },
  }) satisfies Proposal;

describe("aprobar propuestas", () => {
  it("un movimiento solo se guarda al aceptarlo, con su fecha y monto exactos", async () => {
    const fx = await setup();
    const p = movement({ accountId: fx.card.id });
    expect(await fx.count()).toBe(0);
    expect(await acceptProposal(fx.db, p, fx.clock)).toEqual({ ok: true, value: true });
    const row = await fx.db.get<{ occurred_at: string; merchant: string }>(
      "SELECT occurred_at, merchant FROM transactions",
    );
    expect(row?.merchant).toBe("Exito");
    expect(new Date(row?.occurred_at ?? "").getDate()).toBe(19);
    const amount = await fx.db.get<{ a: number }>(
      "SELECT amount_minor AS a FROM entries WHERE category_id = 'cat'",
    );
    expect(amount?.a).toBe(1_200_000);
  });

  it("rechaza montos, fechas y cuentas inválidas sin escribir nada", async () => {
    const fx = await setup();
    const bad = [
      movement({ accountId: fx.card.id, amount: { amount: "1.555", currency: "COP" } }),
      movement({ accountId: fx.card.id, date: "2026-11-25" }),
      movement({ accountId: fx.card.id, date: "2026-02-30" }),
      movement({ accountId: "no-existe" }),
    ];
    for (const p of bad) expect((await acceptProposal(fx.db, p, fx.clock)).ok).toBe(false);
    expect(await fx.count()).toBe(0);
  });

  it("cambia la categoría de un movimiento", async () => {
    const fx = await setup();
    const res = await recordMovement(
      fx.db,
      {
        kind: "expense",
        accountId: fx.card.id,
        categoryId: "cat",
        amount: cop(50_000n),
        occurredAt: NOW,
        merchant: "Cine Colombia",
      },
      fx.clock,
    );
    if (!res.ok) throw res.error;
    const p: Proposal = {
      id: "p2",
      type: "recategorize",
      summary: "Mover",
      payload: { movementId: res.value.id, to: "ocio" },
    };
    expect((await acceptProposal(fx.db, p, fx.clock)).ok).toBe(true);
    const row = await fx.db.get<{ c: string }>(
      "SELECT category_id AS c FROM entries WHERE category_id IS NOT NULL",
    );
    expect(row?.c).toBe("ocio");
  });

  it("crea el presupuesto mensual una sola vez", async () => {
    const fx = await setup();
    const p: Proposal = {
      id: "p3",
      type: "budget",
      summary: "Presupuesto",
      payload: { categoryId: "ocio", amount: { amount: "300000.00", currency: "COP" } },
    };
    expect((await acceptProposal(fx.db, p, fx.clock)).ok).toBe(true);
    expect((await acceptProposal(fx.db, p, fx.clock)).ok).toBe(false);
    const [b] = await listBudgets(fx.db);
    expect(b?.amount.toDecimalString()).toBe("300000.00");
    expect(b?.period).toBe("monthly");
    const broken = {
      ...p,
      payload: { ...p.payload, amount: { amount: "x", currency: "COP" as const } },
    };
    expect((await acceptProposal(fx.db, broken, fx.clock)).ok).toBe(false);
  });

  it("el asistente empieza apagado y se puede encender y apagar", async () => {
    const fx = await setup();
    expect(await assistantEnabled(fx.db)).toBe(false);
    await setAssistantEnabled(fx.db, true);
    expect(await assistantEnabled(fx.db)).toBe(true);
    await setAssistantEnabled(fx.db, false);
    expect(await assistantEnabled(fx.db)).toBe(false);
  });
});

describe("editar propuestas", () => {
  it("hoy es ahora; otro día es mediodía; nunca el futuro", () => {
    expect(occurredAtOf("2026-11-20", NOW)).toBe(NOW);
    expect(occurredAtOf("2026-11-01", NOW)?.getHours()).toBe(12);
    expect(occurredAtOf("2026-11-21", NOW)).toBeNull();
    expect(occurredAtOf("ayer", NOW)).toBeNull();
  });

  it("muestra el monto con formato cuando lo hay", () => {
    expect(proposalAmount(movement())?.toDecimalString()).toBe("12000.00");
    expect(proposalAmount(movement({ amount: { amount: "x", currency: "COP" } }))).toBeNull();
    expect(
      proposalAmount({
        id: "r",
        type: "recategorize",
        summary: "",
        payload: { movementId: "m", to: "c" },
      }),
    ).toBeNull();
  });

  it("abre el formulario adecuado ya lleno", () => {
    expect(editTarget(movement({ accountId: "acc", note: "almuerzo" }))).toEqual({
      pathname: "/movement/new",
      params: {
        kind: "expense",
        category: "cat",
        account: "acc",
        amount: "12000",
        merchant: "Exito",
        note: "almuerzo",
      },
    });
    // Centavos u otra moneda no caben en el teclado de pesos: se escriben a mano.
    expect(
      editTarget(
        movement({ accountId: "acc", merchant: null, amount: { amount: "9.99", currency: "USD" } }),
      ).params,
    ).toEqual({ kind: "expense", category: "cat", account: "acc" });
    expect(
      editTarget({
        id: "r",
        type: "recategorize",
        summary: "",
        payload: { movementId: "m", to: "c" },
      }),
    ).toEqual({ pathname: "/movement/[id]", params: { id: "m" } });
    expect(
      editTarget({
        id: "b",
        type: "budget",
        summary: "",
        payload: { categoryId: null, amount: { amount: "800000.00", currency: "COP" } },
      }),
    ).toEqual({ pathname: "/budgets/new", params: { amount: "800000" } });
    expect(
      editTarget({
        id: "b",
        type: "budget",
        summary: "",
        payload: { categoryId: "ocio", amount: { amount: "80.50", currency: "COP" } },
      }).params,
    ).toEqual({ category: "ocio" });
  });
});
