import { describe, expect, it } from "vitest";
import { z } from "zod";
import { sampleData } from "./sample";
import { callTool, TOOLS, type ToolContext, ToolError } from "./tools";

const ctx: ToolContext = {
  data: sampleData(),
  now: new Date("2026-11-05T15:00:00Z"),
  newId: () => "p-1",
};
const call = (name: string, input: unknown = {}) => callTool(ctx, name, input);
const fails = async (name: string, input: unknown, code: "not_found" | "invalid") => {
  const err = await call(name, input).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ToolError);
  expect((err as ToolError).code).toBe(code);
  return (err as ToolError).message;
};

describe("catálogo", () => {
  it("cada herramienta tiene nombre único, descripción y esquema de objeto", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.input).toBeInstanceOf(z.ZodObject);
    }
  });

  it("ninguna herramienta pide el usuario: el alcance lo pone quien crea los datos", () => {
    for (const t of TOOLS) {
      const keys = Object.keys((t.input as z.ZodObject).shape);
      expect(keys.some((k) => /user|owner|household/i.test(k))).toBe(false);
    }
  });

  it("rechaza herramientas desconocidas y entradas inválidas", async () => {
    await fails("delete_everything", {}, "not_found");
    expect(await fails("month_summary", { month: "2026-13" }, "invalid")).toContain("month");
    await fails("spending_by_category", { from: "2026-02-30", to: "2026-03-01" }, "invalid");
    await fails("spending_by_category", { from: "2026-11-01", to: "2026-10-01" }, "invalid");
    await fails("spending_by_category", { from: "2020-01-01", to: "2026-01-01" }, "invalid");
    await fails("month_summary", { month: "2026-10", currency: "XYZ" }, "invalid");
  });
});

describe("lectura", () => {
  it("lista cuentas con saldo y categorías activas", async () => {
    const accounts = (await call("list_accounts")) as { id: string; balance: unknown }[];
    expect(accounts.map((a) => a.id)).not.toContain("acc-vieja");
    expect(accounts.find((a) => a.id === "acc-visa")?.balance).toEqual({
      amount: "-480000.00",
      currency: "COP",
    });
    expect(await call("list_accounts", { includeArchived: true })).toHaveLength(5);
    const income = (await call("list_categories", { kind: "income" })) as { id: string }[];
    expect(income.map((c) => c.id)).toEqual(["cat-salario"]);
    expect(await call("list_categories")).toHaveLength(5);
  });

  it("suma el gasto por categoría con porcentajes exactos", async () => {
    const res = (await call("spending_by_category", { from: "2026-10-01", to: "2026-10-31" })) as {
      total: unknown;
      categories: { name: string; amount: string; share: number; count: number }[];
    };
    expect(res.total).toEqual({ amount: "550800.00", currency: "COP" });
    expect(res.categories.map((c) => [c.name, c.amount, c.count])).toEqual([
      ["Mercado", "410000.00", 2],
      ["Restaurantes y domicilios", "77900.00", 2],
      ["Entretenimiento", "44900.00", 1],
      ["Transporte", "18000.00", 1],
    ]);
    expect(res.categories[0]?.share).toBe(74.4);
    const income = (await call("spending_by_category", {
      from: "2026-10-01",
      to: "2026-11-30",
      kind: "income",
    })) as { total: unknown };
    expect(income.total).toEqual({ amount: "9000000.00", currency: "COP" });
  });

  it("resume el mes sin transferencias y por moneda", async () => {
    expect(await call("month_summary", { month: "2026-10" })).toEqual({
      month: "2026-10",
      income: { amount: "4500000.00", currency: "COP" },
      expense: { amount: "550800.00", currency: "COP" },
      net: { amount: "3949200.00", currency: "COP" },
      movements: 7,
    });
    const usd = (await call("month_summary", { month: "2026-11", currency: "USD" })) as {
      expense: unknown;
    };
    expect(usd.expense).toEqual({ amount: "12.00", currency: "USD" });
    const dec = (await call("month_summary", { month: "2026-12" })) as { movements: number };
    expect(dec.movements).toBe(0);
  });

  it("filtra movimientos por tipo, cuenta, categoría y texto", async () => {
    type List = {
      total: number;
      movements: { id: string; date: string; category: string | null; toAccount: string | null }[];
    };
    const all = (await call("list_movements", {
      from: "2026-10-01",
      to: "2026-11-30",
      limit: 3,
    })) as List;
    expect(all.total).toBe(11);
    expect(all.movements.map((m) => m.date)).toEqual(["2026-11-03", "2026-11-02", "2026-11-01"]);
    const transfer = (await call("list_movements", {
      from: "2026-10-01",
      to: "2026-10-31",
      accountId: "acc-nequi",
      kind: "transfer",
    })) as List;
    expect(transfer.movements[0]?.toAccount).toBe("Nequi");
    expect(transfer.movements[0]?.category).toBeNull();
    const text = (await call("list_movements", {
      from: "2026-10-01",
      to: "2026-10-31",
      query: "QUINCENA",
    })) as List;
    expect(text.movements.map((m) => m.id)).toEqual(["mov-6"]);
    const cat = (await call("list_movements", {
      from: "2026-10-01",
      to: "2026-11-30",
      categoryId: "cat-mercado",
    })) as List;
    expect(cat.total).toBe(3);
    await fails("list_movements", { from: "2026-10-01", to: "2026-10-31", limit: 500 }, "invalid");
  });
});

describe("propuestas", () => {
  it("propone un gasto validado sin escribir nada", async () => {
    const before = await ctx.data.movements({ from: new Date(0), to: new Date("2030-01-01") });
    const p = await call("propose_movement", {
      kind: "expense",
      accountId: "acc-nequi",
      categoryId: "cat-restaurantes",
      amount: "25000",
      date: "2026-11-04",
      merchant: "Crepes",
    });
    expect(p).toEqual({
      id: "p-1",
      type: "movement",
      summary:
        "Gasto de 25000.00 COP en Restaurantes y domicilios desde Nequi el 2026-11-04 (Crepes)",
      payload: {
        kind: "expense",
        accountId: "acc-nequi",
        categoryId: "cat-restaurantes",
        amount: { amount: "25000.00", currency: "COP" },
        date: "2026-11-04",
        merchant: "Crepes",
      },
    });
    const after = await ctx.data.movements({ from: new Date(0), to: new Date("2030-01-01") });
    expect(after).toHaveLength(before.length);
  });

  it("valida cuenta, categoría, monto y fecha", async () => {
    const base = {
      kind: "expense",
      accountId: "acc-nequi",
      categoryId: "cat-mercado",
      amount: "1000",
      date: "2026-11-04",
    };
    await fails("propose_movement", { ...base, accountId: "acc-de-otra-persona" }, "not_found");
    await fails("propose_movement", { ...base, accountId: "acc-vieja" }, "invalid");
    await fails("propose_movement", { ...base, categoryId: "cat-salario" }, "invalid");
    await fails("propose_movement", { ...base, categoryId: "cat-vieja" }, "invalid");
    await fails("propose_movement", { ...base, amount: "0" }, "invalid");
    await fails("propose_movement", { ...base, amount: "1.000" }, "invalid");
    await fails("propose_movement", { ...base, date: "2026-12-24" }, "invalid");
    const income = (await call("propose_movement", {
      ...base,
      kind: "income",
      categoryId: "cat-salario",
    })) as { summary: string };
    expect(income.summary).toBe("Ingreso de 1000.00 COP en Salario desde Nequi el 2026-11-04");
  });

  it("propone recategorizar solo movimientos propios y con sentido", async () => {
    const p = (await call("propose_recategorize", {
      movementId: "mov-3",
      categoryId: "cat-entretenimiento",
    })) as {
      summary: string;
      payload: unknown;
    };
    expect(p.summary).toBe(
      "Mover Rappi del 2026-10-05 de Restaurantes y domicilios a Entretenimiento",
    );
    expect(p.payload).toEqual({
      movementId: "mov-3",
      from: "cat-restaurantes",
      to: "cat-entretenimiento",
    });
    await fails(
      "propose_recategorize",
      { movementId: "mov-de-otro", categoryId: "cat-mercado" },
      "not_found",
    );
    await fails(
      "propose_recategorize",
      { movementId: "mov-7", categoryId: "cat-mercado" },
      "invalid",
    );
    await fails(
      "propose_recategorize",
      { movementId: "mov-3", categoryId: "cat-salario" },
      "invalid",
    );
    await fails(
      "propose_recategorize",
      { movementId: "mov-3", categoryId: "cat-restaurantes" },
      "invalid",
    );
    await fails("propose_recategorize", { movementId: "mov-3", categoryId: "cat-x" }, "not_found");
  });

  it("propone presupuestos de gasto", async () => {
    const p = (await call("propose_budget", { categoryId: "cat-mercado", amount: "400000" })) as {
      summary: string;
    };
    expect(p.summary).toBe("Presupuesto mensual de 400000.00 COP para Mercado");
    const all = (await call("propose_budget", { amount: "2000000" })) as {
      payload: { categoryId: null };
    };
    expect(all.payload.categoryId).toBeNull();
    await fails("propose_budget", { categoryId: "cat-salario", amount: "1" }, "invalid");
    const id = await callTool({ data: ctx.data, now: ctx.now }, "propose_budget", { amount: "1" });
    expect((id as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
