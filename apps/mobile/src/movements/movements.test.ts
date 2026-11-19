import { describe, expect, it } from "vitest";
import { createFromTemplate } from "../accounts/accounts";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import { templateByKey } from "../accounts/templates";
import { sqliteAccounts } from "../data/ledger-sqlite";
import { keypadAmount, pressKey } from "./keypad";
import { ruleCategoryFor } from "./merchant-rules";
import {
  defaultAccountId,
  listCategories,
  merchantSuggestions,
  recordMovement,
  suggestCategory,
} from "./movements";

async function setup() {
  const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
  const tpl = templateByKey("nequi");
  if (!tpl) throw new Error("falta Nequi");
  const nequi = await createFromTemplate(fx.db, tpl, { openingBalance: cop(500_000n) }, fx.clock);
  if (!nequi.ok) throw nequi.error;
  return { ...fx, nequi: nequi.value };
}

describe("teclado", () => {
  it("escribe pesos enteros, borra y no acepta ceros a la izquierda", () => {
    let d = "";
    for (const k of ["0", "4", "5", "000"] as const) d = pressKey(d, k);
    expect(d).toBe("45000");
    expect(pressKey(d, "back")).toBe("4500");
    expect(pressKey("", "back")).toBe("");
    expect(keypadAmount(d).equals(cop(45_000n))).toBe(true);
    expect(keypadAmount("").isZero()).toBe(true);
  });

  it("no pasa de 13 dígitos", () => {
    const d = "1234567890123";
    expect(pressKey(d, "4")).toBe(d);
  });
});

describe("reglas de comercios", () => {
  it("reconoce comercios colombianos por palabra completa", () => {
    expect(ruleCategoryFor("ÉXITO Calle 80")).toBe("default.mercado");
    expect(ruleCategoryFor("Recarga TuLlave")).toBe("default.transporte");
    expect(ruleCategoryFor("Rappi*Restaurante")).toBe("default.restaurantes");
    expect(ruleCategoryFor("Droguería Cruz Verde")).toBe("default.salud");
    expect(ruleCategoryFor("Aramburo")).toBeNull();
    expect(ruleCategoryFor("")).toBeNull();
  });
});

describe("registro de movimientos", () => {
  it("trae las categorías por defecto, primero las más usadas", async () => {
    const { db, nequi, clock } = await setup();
    const expenses = await listCategories(db, "expense", local(2026, 11, 19));
    expect(expenses.map((c) => c.name)).toContain("Mercado");
    expect(expenses.every((c) => c.kind === "expense")).toBe(true);
    const incomes = await listCategories(db, "income", local(2026, 11, 19));
    expect(incomes.map((c) => c.id)).toEqual(
      expect.arrayContaining(["default.salario", "default.otros_ingresos"]),
    );
    await recordMovement(
      db,
      {
        kind: "expense",
        accountId: nequi.id,
        categoryId: "default.transporte",
        amount: cop(3_200n),
        occurredAt: local(2026, 11, 18),
      },
      clock,
    );
    expect((await listCategories(db, "expense", local(2026, 11, 19)))[0]?.id).toBe(
      "default.transporte",
    );
  });

  it("guarda el gasto, descuenta el saldo y recuerda la cuenta", async () => {
    const { db, nequi, card, clock } = await setup();
    expect(await defaultAccountId(db)).toBe(nequi.id); // "Nequi" < "Visa" por nombre
    const res = await recordMovement(
      db,
      {
        kind: "expense",
        accountId: card.id,
        categoryId: "default.mercado",
        amount: cop(85_000n),
        occurredAt: local(2026, 11, 19),
        merchant: "Éxito",
        note: "Mercado de la semana",
      },
      clock,
    );
    expect(res.ok).toBe(true);
    const repo = sqliteAccounts(db);
    expect((await repo.balance(card)).equals(cop(-85_000n))).toBe(true);
    expect(await defaultAccountId(db)).toBe(card.id);
  });

  it("un ingreso suma a la cuenta", async () => {
    const { db, nequi, clock } = await setup();
    await recordMovement(
      db,
      {
        kind: "income",
        accountId: nequi.id,
        categoryId: "default.salario",
        amount: cop(1_000_000n),
        occurredAt: local(2026, 11, 19),
      },
      clock,
    );
    expect((await sqliteAccounts(db).balance(nequi)).equals(cop(1_500_000n))).toBe(true);
  });

  it("rechaza categoría equivocada o inexistente sin guardar nada", async () => {
    const { db, nequi, clock } = await setup();
    const wrong = await recordMovement(
      db,
      {
        kind: "expense",
        accountId: nequi.id,
        categoryId: "default.salario",
        amount: cop(1n),
        occurredAt: local(2026, 11, 19),
      },
      clock,
    );
    expect(!wrong.ok && wrong.error.code).toBe("invalid_category");
    const missing = await recordMovement(
      db,
      {
        kind: "expense",
        accountId: "no-existe",
        categoryId: "default.mercado",
        amount: cop(1n),
        occurredAt: local(2026, 11, 19),
      },
      clock,
    );
    expect(!missing.ok && missing.error.code).toBe("not_found");
    expect((await sqliteAccounts(db).balance(nequi)).equals(cop(500_000n))).toBe(true);
  });

  it("sin cuentas no hay cuenta por defecto", async () => {
    const { db, nequi, card } = await setup();
    for (const a of [nequi, card])
      await db.run("UPDATE accounts SET archived_at = 'x' WHERE id = ?", a.id);
    expect(await defaultAccountId(db)).toBeNull();
  });
});

describe("autocompletar y sugerir", () => {
  it("sugiere comercios usados y aprende la categoría que elige la persona", async () => {
    const { db, nequi, clock } = await setup();
    const spend = (merchant: string, categoryId: string, day: number) =>
      recordMovement(
        db,
        {
          kind: "expense",
          accountId: nequi.id,
          categoryId,
          amount: cop(10_000n),
          occurredAt: local(2026, 11, day),
          merchant,
        },
        clock,
      );
    // Sin historial: regla de comercios conocidos.
    expect(await suggestCategory(db, "Éxito", "expense")).toBe("default.mercado");
    expect(await suggestCategory(db, "Éxito", "income")).toBeNull();
    expect(await suggestCategory(db, "Tienda de don José", "expense")).toBeNull();
    expect(await suggestCategory(db, "  ", "expense")).toBeNull();
    // La persona prefiere "Compras" para el Éxito: gana su historial.
    await spend("Éxito Unicentro", "default.compras", 1);
    await spend("éxito unicentro", "default.compras", 2);
    await spend("Éxito Unicentro", "default.mercado", 3);
    expect(await suggestCategory(db, "EXITO UNICENTRO", "expense")).toBe("default.compras");
    await spend("Panadería La Nueva", "default.restaurantes", 4);
    expect(await merchantSuggestions(db, "uni")).toEqual(["Éxito Unicentro"]);
    expect(await merchantSuggestions(db, "n")).toHaveLength(2);
    expect(await merchantSuggestions(db, "n", 1)).toHaveLength(1);
    expect(await merchantSuggestions(db, "")).toEqual([]);
    // Lo escrito completo no se sugiere a sí mismo.
    expect(await merchantSuggestions(db, "Panaderia la nueva")).toEqual([]);
  });

  it("no sugiere una categoría por defecto archivada", async () => {
    const { db } = await setup();
    await db.run("UPDATE categories SET archived_at = 'x' WHERE id = 'default.mercado'");
    expect(await suggestCategory(db, "Carulla", "expense")).toBeNull();
  });
});
