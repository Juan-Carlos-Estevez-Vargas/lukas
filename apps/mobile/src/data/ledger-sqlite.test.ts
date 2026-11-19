import { type Account, createAccount, Money, type Transaction, transferFunds } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { createConnection, type RawSql } from "./connection";
import {
  fromDbAmount,
  sqliteAccounts,
  sqliteTransactions,
  sqliteUnitOfWork,
  toDbAmount,
} from "./ledger-sqlite";
import { migrate } from "./migrations";
import { nodeSqlite } from "./node-sqlite.test-helper";
import { LOCAL_MIGRATIONS } from "./schema";

const now = new Date("2026-11-19T12:00:00.000Z");
const cop = (n: bigint) => Money.ofMinor(n, "COP");

/** Base migrada sobre node:sqlite. `failOnEntry` hace fallar el N-ésimo INSERT de asientos. */
async function setup(options: { failOnEntry?: number } = {}) {
  const node = nodeSqlite();
  node.raw.exec("PRAGMA foreign_keys = ON");
  let entryInserts = 0;
  const raw: RawSql = {
    ...node,
    run: async (sql, params) => {
      if (sql.includes("INSERT INTO entries") && ++entryInserts === options.failOnEntry) {
        throw new Error("disco lleno");
      }
      return node.run(sql, params);
    },
  };
  const db = createConnection(raw);
  await migrate(db, LOCAL_MIGRATIONS);
  let n = 0;
  return {
    db,
    accounts: sqliteAccounts(db),
    transactions: sqliteTransactions(db),
    uow: sqliteUnitOfWork(db),
    newId: () => `id-${++n}`,
    now: () => now,
  };
}

async function addAccount(
  repo: ReturnType<typeof sqliteAccounts>,
  id: string,
  extra: Partial<Account> = {},
): Promise<Account> {
  const res = createAccount({ name: id, type: "bank", currency: "COP" }, id, now);
  if (!res.ok) throw res.error;
  const account = { ...res.value, ...extra };
  await repo.save(account);
  return account;
}

describe("cuentas en SQLite", () => {
  it("guarda y lee una tarjeta con todos sus campos", async () => {
    const { accounts } = await setup();
    const res = createAccount(
      {
        name: "Visa",
        type: "credit_card",
        currency: "COP",
        institution: "Bancolombia",
        last4: "1234",
        closingDay: 15,
        dueDay: 30,
        creditLimit: cop(500_000_000n),
      },
      "visa",
      now,
    );
    if (!res.ok) throw res.error;
    await accounts.save(res.value);
    expect(await accounts.get("visa")).toEqual(res.value);
    expect(await accounts.get("nada")).toBeNull();
  });

  it("actualiza al guardar de nuevo y oculta las archivadas de la lista", async () => {
    const { accounts } = await setup();
    const a = await addAccount(accounts, "a");
    await addAccount(accounts, "b");
    await accounts.save({ ...a, archivedAt: now, version: 2, name: "A vieja" });
    expect((await accounts.list()).map((x) => x.id)).toEqual(["b"]);
    expect((await accounts.list({ includeArchived: true })).map((x) => x.name)).toEqual([
      "A vieja",
      "b",
    ]);
  });
});

describe("transacciones en SQLite", () => {
  const groceries = (accountId: string): Transaction => ({
    id: "t1",
    occurredAt: now,
    description: "Mercado",
    merchant: "Éxito",
    notes: null,
    status: "cleared",
    source: "manual",
    entries: [
      { id: "e1", target: { accountId }, amount: cop(-12_345_00n) },
      { id: "e2", target: { categoryId: "food" }, amount: cop(12_345_00n) },
    ],
    createdAt: now,
    updatedAt: now,
    version: 1,
  });

  it("guarda y lee una transacción con sus asientos", async () => {
    const { db, accounts, transactions } = await setup();
    await addAccount(accounts, "a");
    await db.run(
      "INSERT INTO categories (id, name, kind, created_at, updated_at) VALUES ('food', 'Comida', 'expense', ?, ?)",
      now.toISOString(),
      now.toISOString(),
    );
    await transactions.save(groceries("a"));
    expect(await transactions.get("t1")).toEqual(groceries("a"));
    expect(await transactions.get("nada")).toBeNull();
  });

  it("reemplaza los asientos al guardar de nuevo", async () => {
    const { db, accounts, transactions } = await setup();
    const a = await addAccount(accounts, "a");
    await addAccount(accounts, "b");
    await db.run(
      "INSERT INTO categories (id, name, kind, created_at, updated_at) VALUES ('food', 'Comida', 'expense', ?, ?)",
      now.toISOString(),
      now.toISOString(),
    );
    await transactions.save(groceries("a"));
    await transactions.save({ ...groceries("b"), version: 2 });
    expect(await accounts.balance(a)).toEqual(cop(0n));
    expect((await transactions.get("t1"))?.version).toBe(2);
  });

  it("rechaza una transacción descuadrada sin escribir nada", async () => {
    const { db, accounts, transactions } = await setup();
    await addAccount(accounts, "a");
    await addAccount(accounts, "b");
    const bad = groceries("a");
    await expect(
      transactions.save({
        ...bad,
        entries: [
          { id: "e1", target: { accountId: "a" }, amount: cop(-100n) },
          { id: "e2", target: { accountId: "b" }, amount: cop(99n) },
        ],
      }),
    ).rejects.toMatchObject({ code: "unbalanced" });
    expect(await db.get("SELECT count(*) AS n FROM transactions")).toEqual({ n: 0 });
  });
});

describe("unidad de trabajo", () => {
  it("una transferencia mueve el saldo y el patrimonio no cambia", async () => {
    const ctx = await setup();
    const a = await addAccount(ctx.accounts, "a");
    const b = await addAccount(ctx.accounts, "b");
    const res = await transferFunds(ctx, {
      fromAccountId: "a",
      toAccountId: "b",
      amount: cop(5_000_000n),
      occurredAt: now,
    });
    expect(res.ok).toBe(true);
    const [ba, bb] = [await ctx.accounts.balance(a), await ctx.accounts.balance(b)];
    expect([ba.amountMinor, bb.amountMinor]).toEqual([-5_000_000n, 5_000_000n]);
    expect(ba.add(bb).isZero()).toBe(true);
  });

  it("una transferencia que falla a mitad no deja saldos descuadrados", async () => {
    // El primer asiento se escribe y el segundo falla: la transacción entera se revierte.
    const ctx = await setup({ failOnEntry: 2 });
    const a = await addAccount(ctx.accounts, "a");
    const b = await addAccount(ctx.accounts, "b");
    await expect(
      transferFunds(ctx, {
        fromAccountId: "a",
        toAccountId: "b",
        amount: cop(5_000_000n),
        occurredAt: now,
      }),
    ).rejects.toThrow("disco lleno");
    expect(await ctx.accounts.balance(a)).toEqual(cop(0n));
    expect(await ctx.accounts.balance(b)).toEqual(cop(0n));
    expect(await ctx.db.get("SELECT count(*) AS n FROM entries")).toEqual({ n: 0 });
    expect(await ctx.db.get("SELECT count(*) AS n FROM transactions")).toEqual({ n: 0 });
  });

  it("devuelve el valor de la unidad de trabajo", async () => {
    const ctx = await setup();
    await addAccount(ctx.accounts, "a");
    expect(await ctx.uow.run(async ({ accounts }) => (await accounts.list()).length)).toBe(1);
  });
});

describe("conversión de montos", () => {
  it("convierte entre bigint y number sin perder precisión", () => {
    expect(toDbAmount(cop(9_007_199_254_740_991n))).toBe(9_007_199_254_740_991);
    expect(fromDbAmount(-250, "COP")).toEqual(cop(-250n));
  });

  it("rechaza montos fuera de rango, corruptos o con moneda desconocida", () => {
    expect(() => toDbAmount(cop(9_007_199_254_740_992n))).toThrow(RangeError);
    expect(() => fromDbAmount(1.5, "COP")).toThrow(RangeError);
    expect(() => fromDbAmount(1, "XYZ")).toThrow(/Moneda desconocida/);
  });
});
