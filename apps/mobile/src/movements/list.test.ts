import { describe, expect, it } from "vitest";
import { createFromTemplate } from "../accounts/accounts";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import { templateByKey } from "../accounts/templates";
import { amountQuery, filtersToSpec, type MovementFilters } from "./filters";
import { groupByDay, listMovements, PAGE_SIZE } from "./list";
import { recordMovement } from "./movements";
import { recordTransfer } from "./transfers";

async function setup() {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const tpl = templateByKey("nequi");
  if (!tpl) throw new Error("Nequi");
  const nequi = await createFromTemplate(fx.db, tpl, { openingBalance: cop(500_000n) }, fx.clock);
  if (!nequi.ok) throw nequi.error;
  const n = nequi.value;
  const spend = (merchant: string, categoryId: string, pesos: bigint, day: number, extra = {}) =>
    recordMovement(
      fx.db,
      {
        kind: "expense",
        accountId: n.id,
        categoryId,
        amount: cop(pesos),
        occurredAt: local(2026, 11, day, 10),
        merchant,
        ...extra,
      },
      fx.clock,
    );
  await spend("Éxito Unicentro", "default.mercado", 85_400n, 17, {
    tags: ["Casa"],
    receipt: { fileName: "r.jpg", mimeType: "image/jpeg" },
    note: "mercado quincenal",
  });
  await spend("Rappi", "default.restaurantes", 32_000n, 18);
  await recordMovement(
    fx.db,
    {
      kind: "income",
      accountId: n.id,
      categoryId: "default.salario",
      amount: cop(2_000_000n),
      occurredAt: local(2026, 11, 18, 8),
    },
    fx.clock,
  );
  await recordTransfer(
    fx.db,
    {
      fromAccountId: n.id,
      toAccountId: fx.card.id,
      amount: cop(300_000n),
      fee: cop(1_200n),
      occurredAt: local(2026, 11, 19, 9),
    },
    fx.clock,
  );
  return { ...fx, nequi: n };
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("listMovements", () => {
  it("lista del más reciente al más antiguo, con tipo y monto para mostrar", async () => {
    const { db } = await setup();
    const rows = await listMovements(db, {});
    expect(rows.map((r) => [r.kind, r.title, r.amount.toDecimalString()])).toEqual([
      ["transfer", "Nequi → Visa", "300000.00"],
      ["expense", "Rappi", "-32000.00"],
      ["income", "Salario", "2000000.00"],
      ["expense", "Éxito Unicentro", "-85400.00"],
      ["adjustment", "Saldo inicial", "500000.00"],
    ]);
    const exito = rows[3];
    expect(exito?.tags).toEqual(["Casa"]);
    expect(exito?.hasReceipt).toBe(true);
    expect(exito?.categoryNames).toEqual(["Mercado"]);
  });

  it.each<[string, MovementFilters, string[]]>([
    ["texto en comercio sin tildes", { text: "exito" }, ["Éxito Unicentro"]],
    ["texto en la nota", { text: "quincenal" }, ["Éxito Unicentro"]],
    ["texto en la categoría", { text: "restaur" }, ["Rappi"]],
    ["monto con puntos", { text: "85.400" }, ["Éxito Unicentro"]],
    ["monto de la comisión", { text: "1200" }, ["Nequi → Visa"]],
    ["gastos", { kind: "expense" }, ["Rappi", "Éxito Unicentro"]],
    ["ingresos", { kind: "income" }, ["Salario"]],
    ["transferencias", { kind: "transfer" }, ["Nequi → Visa"]],
    ["etiqueta sin mayúsculas", { tag: "casa" }, ["Éxito Unicentro"]],
    ["categoría", { categoryId: "default.restaurantes" }, ["Rappi"]],
    [
      "rango de fechas y tipo combinados",
      { kind: "expense", from: local(2026, 11, 18, 0), to: local(2026, 11, 19, 0) },
      ["Rappi"],
    ],
    ["sin resultados", { text: "netflix" }, []],
  ])("filtra por %s", async (_name, filters, titles) => {
    const { db } = await setup();
    const rows = await listMovements(db, filters);
    expect(rows.map((r) => r.title)).toEqual(titles);
    // La especificación en memoria dice lo mismo que la consulta.
    const all = await listMovements(db, {});
    const spec = filtersToSpec(filters);
    expect(ids(all.filter((r) => spec.isSatisfiedBy(r)))).toEqual(ids(rows));
  });

  it("filtra por cuenta", async () => {
    const { db, card } = await setup();
    expect((await listMovements(db, { accountId: card.id })).map((r) => r.kind)).toEqual([
      "transfer",
    ]);
  });

  it("escapa los comodines de LIKE", async () => {
    const { db } = await setup();
    expect(await listMovements(db, { text: "%" })).toEqual([]);
    expect(await listMovements(db, { text: "_" })).toEqual([]);
  });

  it("pagina de a PAGE_SIZE", async () => {
    const { db } = await setup();
    expect(await listMovements(db, {}, 1)).toEqual([]);
    expect(PAGE_SIZE).toBe(50);
  });
});

describe("groupByDay", () => {
  it("agrupa por día y suma el neto en pesos sin transferencias", async () => {
    const { db } = await setup();
    const sections = groupByDay(await listMovements(db, {}));
    expect(sections.map((s) => [s.key, s.rows.length, s.net.toDecimalString()])).toEqual([
      ["2026-11-19", 1, "0.00"],
      ["2026-11-18", 2, "1968000.00"],
      ["2026-11-17", 1, "-85400.00"],
      ["2026-10-01", 1, "0.00"],
    ]);
  });
});

describe("amountQuery", () => {
  it("entiende montos colombianos", () => {
    expect(amountQuery("$ 45.000")).toBe(4_500_000n);
    expect(amountQuery("12,5")).toBe(1_250n);
    expect(amountQuery("abc")).toBeNull();
    expect(amountQuery("1,234")).toBeNull();
  });
});
