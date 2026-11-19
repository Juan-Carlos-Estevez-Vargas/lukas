import type { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accounts, auditLog, categories, entries, transactions, users } from "./schema";
import { createTestDatabase, insertUsers, newId } from "./test/database";

type Db = Awaited<ReturnType<typeof createTestDatabase>>["db"];

let client: PGlite;
let db: Db;

const ALICE = "user_alice";
const BOB = "user_bob";
const ids = {
  nequi: newId(),
  bancolombia: newId(),
  usdAccount: newId(),
  mercado: newId(),
  trading: newId(),
  bobAccount: newId(),
};

beforeAll(async () => {
  ({ client, db } = await createTestDatabase());
  await insertUsers(db, ALICE, BOB);
  await db.insert(accounts).values([
    { id: ids.nequi, userId: ALICE, name: "Nequi", type: "digital_wallet", currency: "COP" },
    { id: ids.bancolombia, userId: ALICE, name: "Bancolombia", type: "bank", currency: "COP" },
    { id: ids.usdAccount, userId: ALICE, name: "Cuenta USD", type: "bank", currency: "USD" },
    { id: ids.bobAccount, userId: BOB, name: "Bob", type: "cash", currency: "COP" },
  ]);
  await db.insert(categories).values([
    { id: ids.mercado, userId: ALICE, name: "Mercado", kind: "expense" },
    { id: ids.trading, userId: ALICE, name: "Cambio de divisas", kind: "trading", isSystem: true },
  ]);
});

afterAll(async () => {
  await client.close();
});

type EntryInput = Omit<typeof entries.$inferInsert, "id" | "transactionId" | "userId"> & {
  userId?: string;
};

const record = (lines: EntryInput[], owner = ALICE) =>
  db.transaction(async (tx) => {
    const transactionId = newId();
    await tx.insert(transactions).values({
      id: transactionId,
      userId: owner,
      occurredAt: new Date("2026-10-27T15:00:00Z"),
      description: "prueba",
    });
    for (const line of lines) {
      await tx.insert(entries).values({ id: newId(), transactionId, userId: owner, ...line });
    }
    return transactionId;
  });

/** Mensaje de la causa raíz que lanza Postgres a través de Drizzle. */
const failure = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return cause?.message ?? (error as Error).message;
  }
  throw new Error("Se esperaba que la operación fallara");
};

describe("libro mayor de doble partida", () => {
  it("guarda un gasto cuyos asientos suman cero", async () => {
    const id = await record([
      { accountId: ids.nequi, amountMinor: -4590000n, currency: "COP" },
      { categoryId: ids.mercado, amountMinor: 4590000n, currency: "COP" },
    ]);
    const saved = await db.select().from(entries).where(eq(entries.transactionId, id));
    expect(saved).toHaveLength(2);
  });

  it("guarda una transferencia entre cuentas", async () => {
    await expect(
      record([
        { accountId: ids.bancolombia, amountMinor: -10000000n, currency: "COP" },
        { accountId: ids.nequi, amountMinor: 10000000n, currency: "COP" },
      ]),
    ).resolves.toBeTypeOf("string");
  });

  it("rechaza en el commit asientos que no suman cero", async () => {
    const message = await failure(
      record([
        { accountId: ids.nequi, amountMinor: -1000n, currency: "COP" },
        { categoryId: ids.mercado, amountMinor: 999n, currency: "COP" },
      ]),
    );
    expect(message).toMatch(/no suman cero en COP/);
  });

  it("rechaza transacciones con un solo asiento o sin asientos", async () => {
    expect(
      await failure(record([{ accountId: ids.nequi, amountMinor: -1000n, currency: "COP" }])),
    ).toMatch(/al menos dos asientos/);
    expect(await failure(record([]))).toMatch(/al menos dos asientos/);
  });

  it("acepta cambios de moneda equilibrados por categoría de trading", async () => {
    await expect(
      record([
        { accountId: ids.usdAccount, amountMinor: -10000n, currency: "USD" },
        { categoryId: ids.trading, amountMinor: 10000n, currency: "USD" },
        { categoryId: ids.trading, amountMinor: -41234500n, currency: "COP" },
        { accountId: ids.nequi, amountMinor: 41234500n, currency: "COP" },
      ]),
    ).resolves.toBeTypeOf("string");
  });

  it("rechaza un asiento en una moneda distinta a la de su cuenta", async () => {
    const message = await failure(
      record([
        { accountId: ids.nequi, amountMinor: -100n, currency: "USD" },
        { categoryId: ids.mercado, amountMinor: 100n, currency: "USD" },
      ]),
    );
    expect(message).toMatch(/no coincide con la de la cuenta/);
  });

  it("impide usar cuentas o categorías de otro usuario", async () => {
    expect(
      await failure(
        record([
          { accountId: ids.bobAccount, amountMinor: -100n, currency: "COP" },
          { categoryId: ids.mercado, amountMinor: 100n, currency: "COP" },
        ]),
      ),
    ).toMatch(/cuenta no pertenece/);

    expect(
      await failure(
        record(
          [
            { accountId: ids.bobAccount, amountMinor: -100n, currency: "COP" },
            { categoryId: ids.mercado, amountMinor: 100n, currency: "COP" },
          ],
          BOB,
        ),
      ),
    ).toMatch(/categoría no pertenece/);

    expect(
      await failure(
        record([
          { accountId: ids.nequi, amountMinor: -100n, currency: "COP", userId: BOB },
          { categoryId: ids.mercado, amountMinor: 100n, currency: "COP" },
        ]),
      ),
    ).toMatch(/dueño de la transacción/);
  });

  it("exige que cada asiento toque una cuenta o una categoría, no ambas", async () => {
    const message = await failure(
      record([
        { accountId: ids.nequi, categoryId: ids.mercado, amountMinor: -1n, currency: "COP" },
        { categoryId: ids.mercado, amountMinor: 1n, currency: "COP" },
      ]),
    );
    expect(message).toMatch(/entries_account_xor_category/);
  });

  it("rechaza borrar un asiento si la transacción queda descuadrada", async () => {
    const id = await record([
      { accountId: ids.nequi, amountMinor: -500n, currency: "COP" },
      { categoryId: ids.mercado, amountMinor: 500n, currency: "COP" },
    ]);
    const message = await failure(
      db.transaction(async (tx) => {
        const [first] = await tx.select().from(entries).where(eq(entries.transactionId, id));
        await tx.delete(entries).where(eq(entries.id, first?.id ?? ""));
      }),
    );
    expect(message).toMatch(/al menos dos asientos/);
  });

  it("borra los asientos en cascada al borrar la transacción", async () => {
    const id = await record([
      { accountId: ids.nequi, amountMinor: -700n, currency: "COP" },
      { categoryId: ids.mercado, amountMinor: 700n, currency: "COP" },
    ]);
    await db.delete(transactions).where(eq(transactions.id, id));
    const left = await db.select().from(entries).where(eq(entries.transactionId, id));
    expect(left).toHaveLength(0);
  });
});

describe("restricciones de cuentas", () => {
  it("solo guarda los últimos 4 dígitos numéricos", async () => {
    const message = await failure(
      db.insert(accounts).values({
        id: newId(),
        userId: ALICE,
        name: "Tarjeta",
        type: "credit_card",
        currency: "COP",
        last4: "12a4",
      }),
    );
    expect(message).toMatch(/accounts_last4_digits/);
  });
});

describe("bitácora de auditoría", () => {
  it("permite insertar pero no modificar ni borrar", async () => {
    await db.insert(auditLog).values({ actor: "system", action: "login", entity: "session" });
    expect(await failure(db.update(auditLog).set({ action: "x" }))).toMatch(/solo inserción/);
    expect(await failure(db.delete(auditLog))).toMatch(/solo inserción/);
    const [{ count } = { count: 0 }] = await db
      .execute<{ count: number }>(sql`select count(*)::int as count from app.audit_log`)
      .then((r) => r.rows);
    expect(count).toBe(1);
  });
});

describe("supresión de cuenta (Ley 1581)", () => {
  it("al borrar el usuario se borran sus datos pero se conserva la auditoría", async () => {
    const carol = "user_carol";
    await insertUsers(db, carol);
    const wallet = newId();
    const food = newId();
    await db.insert(accounts).values({
      id: wallet,
      userId: carol,
      name: "Daviplata",
      type: "digital_wallet",
      currency: "COP",
    });
    await db
      .insert(categories)
      .values({ id: food, userId: carol, name: "Mercado", kind: "expense" });
    await record(
      [
        { accountId: wallet, amountMinor: -500n, currency: "COP" },
        { categoryId: food, amountMinor: 500n, currency: "COP" },
      ],
      carol,
    );
    await db
      .insert(auditLog)
      .values({ userId: carol, actor: carol, action: "account.delete", entity: "user" });

    await db.delete(users).where(eq(users.id, carol));

    expect(await db.select().from(accounts).where(eq(accounts.userId, carol))).toHaveLength(0);
    expect(await db.select().from(transactions).where(eq(transactions.userId, carol))).toHaveLength(
      0,
    );
    expect(await db.select().from(entries).where(eq(entries.userId, carol))).toHaveLength(0);
    expect(await db.select().from(auditLog).where(eq(auditLog.userId, carol))).toHaveLength(1);
  });
});
