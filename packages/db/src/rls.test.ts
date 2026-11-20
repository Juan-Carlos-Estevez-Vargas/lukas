import type { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withUser } from "./rls";
import {
  accounts,
  aiUsage,
  auditLog,
  categories,
  changes,
  entries,
  exchangeRates,
  householdMembers,
  households,
  idempotencyKeys,
  outbox,
  pushDevices,
  transactionEmbeddings,
  transactions,
} from "./schema";
import { createTestDatabase, insertUsers, newId } from "./test/database";

type Db = Awaited<ReturnType<typeof createTestDatabase>>["db"];

let client: PGlite;
let db: Db;

// Ana y Beto comparten el hogar; Carla es una extraña.
const ANA = "user_ana";
const BETO = "user_beto";
const CARLA = "user_carla";
const home = newId();
const ids = {
  anaPrivate: newId(),
  anaShared: newId(),
  betoAccount: newId(),
  carlaAccount: newId(),
  anaMercado: newId(),
  anaTx: newId(),
  anaSharedTx: newId(),
  carlaCategory: newId(),
};

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

const expense = (id: string, accountId: string, householdId: string | null) =>
  db.transaction(async (tx) => {
    await tx.insert(transactions).values({
      id,
      userId: ANA,
      householdId,
      occurredAt: new Date("2026-11-01T15:00:00Z"),
      description: "Mercado",
    });
    await tx.insert(entries).values([
      {
        id: newId(),
        transactionId: id,
        userId: ANA,
        accountId,
        amountMinor: -50_000_00n,
        currency: "COP",
      },
      {
        id: newId(),
        transactionId: id,
        userId: ANA,
        categoryId: ids.anaMercado,
        amountMinor: 50_000_00n,
        currency: "COP",
      },
    ]);
  });

beforeAll(async () => {
  ({ client, db } = await createTestDatabase());
  await insertUsers(db, ANA, BETO, CARLA);
  // Datos de partida como dueño de las tablas (sin RLS), igual que una migración o un seed.
  await db.insert(households).values({ id: home, name: "Casa", createdBy: ANA });
  await db.insert(householdMembers).values([
    { householdId: home, userId: ANA, role: "owner" },
    { householdId: home, userId: BETO, role: "member" },
  ]);
  await db.insert(accounts).values([
    { id: ids.anaPrivate, userId: ANA, name: "Nequi Ana", type: "digital_wallet", currency: "COP" },
    {
      id: ids.anaShared,
      userId: ANA,
      householdId: home,
      name: "Cuenta de la casa",
      type: "bank",
      currency: "COP",
    },
    { id: ids.betoAccount, userId: BETO, name: "Beto", type: "cash", currency: "COP" },
    { id: ids.carlaAccount, userId: CARLA, name: "Carla", type: "cash", currency: "COP" },
  ]);
  await db.insert(categories).values([
    { id: ids.anaMercado, userId: ANA, name: "Mercado", kind: "expense" },
    { id: ids.carlaCategory, userId: CARLA, name: "Carla", kind: "expense" },
  ]);
  await expense(ids.anaTx, ids.anaPrivate, null);
  await expense(ids.anaSharedTx, ids.anaShared, home);
  await db.insert(changes).values({
    userId: ANA,
    entity: "accounts",
    entityId: ids.anaPrivate,
    op: "upsert",
    version: 1,
  });
  await db
    .insert(idempotencyKeys)
    .values({ userId: ANA, key: "k1", requestHash: "h", responseStatus: 201 });
  await db.insert(outbox).values({
    id: newId(),
    aggregate: "account",
    aggregateId: ids.anaPrivate,
    eventType: "created",
    payload: {},
  });
});

afterAll(async () => {
  await client.close();
});

describe("aislamiento entre usuarios (RLS)", () => {
  it("cada usuario ve solo lo suyo y lo de sus hogares", async () => {
    const seen = (user: string) =>
      withUser(db, user, async (tx) => (await tx.select().from(accounts)).map((a) => a.id).sort());
    expect(await seen(ANA)).toEqual([ids.anaPrivate, ids.anaShared].sort());
    expect(await seen(BETO)).toEqual([ids.anaShared, ids.betoAccount].sort());
    expect(await seen(CARLA)).toEqual([ids.carlaAccount]);
  });

  it("una extraña no lee ningún dato de otro usuario, en ninguna tabla", async () => {
    const leaks = await withUser(db, CARLA, async (tx) => ({
      accounts: await tx.select().from(accounts).where(sql`${accounts.userId} <> ${CARLA}`),
      categories: await tx.select().from(categories).where(sql`${categories.userId} <> ${CARLA}`),
      transactions: await tx.select().from(transactions),
      entries: await tx.select().from(entries),
      changes: await tx.select().from(changes),
      idempotency: await tx.select().from(idempotencyKeys),
      households: await tx.select().from(households),
      members: await tx.select().from(householdMembers),
      audit: await tx.select().from(auditLog).where(sql`${auditLog.userId} <> ${CARLA}`),
    }));
    for (const rows of Object.values(leaks)) expect(rows).toEqual([]);
  });

  it("buscar por id un registro ajeno no devuelve nada", async () => {
    const found = await withUser(db, CARLA, (tx) =>
      tx.select().from(transactions).where(eq(transactions.id, ids.anaTx)),
    );
    expect(found).toEqual([]);
  });

  it("los miembros del hogar ven las transacciones compartidas y sus asientos, no las privadas", async () => {
    const beto = await withUser(db, BETO, async (tx) => ({
      transactions: (await tx.select().from(transactions)).map((t) => t.id),
      entries: (await tx.select().from(entries)).map((e) => e.transactionId),
    }));
    expect(beto.transactions).toEqual([ids.anaSharedTx]);
    expect(new Set(beto.entries)).toEqual(new Set([ids.anaSharedTx]));
  });

  it("sin usuario en la sesión no se ve nada", async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE lukas_app`);
      return tx.select().from(accounts);
    });
    expect(rows).toEqual([]);
  });

  it("no se puede escribir a nombre de otro", async () => {
    const message = await failure(
      withUser(db, CARLA, (tx) =>
        tx
          .insert(accounts)
          .values({ id: newId(), userId: ANA, name: "Falsa", type: "cash", currency: "COP" }),
      ),
    );
    expect(message).toMatch(/row-level security/);
  });

  it("no se puede cambiar ni borrar lo ajeno, aunque sea compartido", async () => {
    const touched = await withUser(db, BETO, async (tx) => ({
      updated: await tx
        .update(accounts)
        .set({ name: "Mía" })
        .where(eq(accounts.id, ids.anaShared))
        .returning(),
      deleted: await tx.delete(categories).where(eq(categories.id, ids.anaMercado)).returning(),
    }));
    expect(touched).toEqual({ updated: [], deleted: [] });
    const [shared] = await db.select().from(accounts).where(eq(accounts.id, ids.anaShared));
    expect(shared?.name).toBe("Cuenta de la casa");
  });

  it("no se puede pasar un registro propio a otro dueño", async () => {
    const message = await failure(
      withUser(db, CARLA, (tx) =>
        tx.update(accounts).set({ userId: ANA }).where(eq(accounts.id, ids.carlaAccount)),
      ),
    );
    expect(message).toMatch(/row-level security/);
  });

  it("solo se comparte con hogares de los que se es miembro", async () => {
    const message = await failure(
      withUser(db, CARLA, (tx) =>
        tx.update(accounts).set({ householdId: home }).where(eq(accounts.id, ids.carlaAccount)),
      ),
    );
    expect(message).toMatch(/row-level security/);
    const shared = await withUser(db, BETO, (tx) =>
      tx
        .update(accounts)
        .set({ householdId: home })
        .where(eq(accounts.id, ids.betoAccount))
        .returning(),
    );
    expect(shared).toHaveLength(1);
  });

  it("la bandeja de salida es solo del servidor", async () => {
    const message = await failure(withUser(db, ANA, (tx) => tx.select().from(outbox)));
    expect(message).toMatch(/permission denied/);
  });

  it("las tasas de cambio son públicas y de solo lectura", async () => {
    await db
      .insert(exchangeRates)
      .values({ base: "USD", quote: "COP", day: "2026-11-18", rate: "4100.5", source: "test" });
    const rates = await withUser(db, CARLA, (tx) => tx.select().from(exchangeRates));
    expect(rates).toHaveLength(1);
    const message = await failure(withUser(db, CARLA, (tx) => tx.delete(exchangeRates)));
    expect(message).toMatch(/permission denied/);
  });

  it("los ajustes de sesión no se filtran a la siguiente consulta", async () => {
    await withUser(db, CARLA, (tx) => tx.select().from(accounts));
    const after = await db.execute(
      sql`SELECT current_user AS role, current_setting('app.user_id', true) AS uid`,
    );
    expect(after.rows[0]).toMatchObject({ role: "postgres" });
    expect((after.rows[0] as { uid: string | null }).uid ?? "").toBe("");
  });

  it("exige un usuario", async () => {
    await expect(withUser(db, " ", async () => 1)).rejects.toThrow(/usuario/);
  });
});

describe("hogares", () => {
  it("quien crea un hogar se agrega como dueño y luego invita", async () => {
    const id = newId();
    await withUser(db, CARLA, async (tx) => {
      await tx.insert(households).values({ id, name: "Apto", createdBy: CARLA });
      await tx.insert(householdMembers).values({ householdId: id, userId: CARLA, role: "owner" });
      await tx.insert(householdMembers).values({ householdId: id, userId: BETO });
    });
    const members = await withUser(db, BETO, (tx) =>
      tx.select().from(householdMembers).where(eq(householdMembers.householdId, id)),
    );
    expect(members.map((m) => m.userId).sort()).toEqual([BETO, CARLA]);
  });

  it("un miembro no puede invitar ni volverse dueño", async () => {
    expect(
      await failure(
        withUser(db, BETO, (tx) =>
          tx.insert(householdMembers).values({ householdId: home, userId: CARLA }),
        ),
      ),
    ).toMatch(/row-level security/);
    const promoted = await withUser(db, BETO, (tx) =>
      tx
        .update(householdMembers)
        .set({ role: "owner" })
        .where(eq(householdMembers.userId, BETO))
        .returning(),
    );
    expect(promoted.filter((m) => m.householdId === home)).toEqual([]);
  });

  it("nadie se une solo a un hogar ajeno", async () => {
    expect(
      await failure(
        withUser(db, CARLA, (tx) =>
          tx.insert(householdMembers).values({ householdId: home, userId: CARLA, role: "owner" }),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it("un miembro puede salirse y deja de ver lo compartido", async () => {
    await db.insert(householdMembers).values({ householdId: home, userId: CARLA });
    expect(
      (
        await withUser(db, CARLA, (tx) =>
          tx.select().from(accounts).where(eq(accounts.id, ids.anaShared)),
        )
      ).length,
    ).toBe(1);
    await withUser(db, CARLA, (tx) =>
      tx.delete(householdMembers).where(eq(householdMembers.userId, CARLA)),
    );
    expect(
      await withUser(db, CARLA, (tx) =>
        tx.select().from(accounts).where(eq(accounts.id, ids.anaShared)),
      ),
    ).toEqual([]);
  });
});

describe("auditoría de accesos", () => {
  it("registra quién escribió y de quién era el registro", async () => {
    const id = newId();
    await withUser(db, ANA, (tx) =>
      tx.insert(accounts).values({ id, userId: ANA, name: "Nueva", type: "cash", currency: "COP" }),
    );
    const log = await withUser(db, ANA, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.entityId, id)),
    );
    expect(log).toMatchObject([
      { userId: ANA, actor: "user", action: "insert", entity: "accounts", metadata: null },
    ]);
  });

  it("registra accesos que no son escrituras, siempre a nombre de la sesión", async () => {
    await withUser(db, BETO, (tx) =>
      tx.execute(sql`SELECT app.audit('export', 'transactions', NULL, '{"format":"csv"}'::jsonb)`),
    );
    const log = await withUser(db, BETO, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.action, "export")),
    );
    expect(log).toMatchObject([
      { userId: BETO, entity: "transactions", metadata: { format: "csv" } },
    ]);
    const anonymous = await failure(db.execute(sql`SELECT app.audit('export', 'x', NULL)`));
    expect(anonymous).toMatch(/Sin usuario/);
  });

  it("la app no puede escribir ni borrar la bitácora directamente", async () => {
    const insert = await failure(
      withUser(db, CARLA, (tx) =>
        tx
          .insert(auditLog)
          .values({ userId: ANA, actor: "user", action: "forged", entity: "accounts" }),
      ),
    );
    expect(insert).toMatch(/permission denied/);
    const remove = await failure(withUser(db, CARLA, (tx) => tx.delete(auditLog)));
    expect(remove).toMatch(/permission denied/);
  });

  it("las escrituras del sistema quedan como `system`", async () => {
    const [row] = await db.select().from(auditLog).where(eq(auditLog.entityId, ids.carlaAccount));
    expect(row).toMatchObject({ actor: "system", userId: CARLA, action: "insert" });
  });
});

describe("uso del agente de IA", () => {
  it("cada quien solo ve y suma su propio uso", async () => {
    await withUser(db, ANA, (tx) =>
      tx.insert(aiUsage).values({ userId: ANA, day: "2026-11-20", tokens: 1200, requests: 1 }),
    );
    const forged = await failure(
      withUser(db, CARLA, (tx) =>
        tx.insert(aiUsage).values({ userId: ANA, day: "2026-11-21", tokens: 0, requests: 0 }),
      ),
    );
    expect(forged).toMatch(/row-level security/);
    expect(await withUser(db, CARLA, (tx) => tx.select().from(aiUsage))).toEqual([]);
    expect(await withUser(db, ANA, (tx) => tx.select().from(aiUsage))).toHaveLength(1);
    const negative = await failure(
      withUser(db, ANA, (tx) =>
        tx.update(aiUsage).set({ tokens: -1 }).where(eq(aiUsage.userId, ANA)),
      ),
    );
    expect(negative).toMatch(/ai_usage_counts/);
  });
});

describe("teléfonos para avisos", () => {
  it("cada quien registra y ve solo sus teléfonos", async () => {
    const token = "ExponentPushToken[ana-telefono]";
    await withUser(db, ANA, (tx) =>
      tx.insert(pushDevices).values({ userId: ANA, token, platform: "android" }),
    );
    const forged = await failure(
      withUser(db, CARLA, (tx) =>
        tx.insert(pushDevices).values({ userId: ANA, token: `${token}2`, platform: "android" }),
      ),
    );
    expect(forged).toMatch(/row-level security/);
    expect(await withUser(db, CARLA, (tx) => tx.select().from(pushDevices))).toEqual([]);
    await withUser(db, CARLA, (tx) => tx.delete(pushDevices));
    expect(await withUser(db, ANA, (tx) => tx.select().from(pushDevices))).toHaveLength(1);
    const short = await failure(
      withUser(db, ANA, (tx) =>
        tx.insert(pushDevices).values({ userId: ANA, token: "x", platform: "ios" }),
      ),
    );
    expect(short).toMatch(/push_devices_token_shape/);
  });
});

describe("embeddings de movimientos", () => {
  it("cada quien indexa y busca solo en sus movimientos", async () => {
    const embedding = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
    await withUser(db, ANA, (tx) =>
      tx
        .insert(transactionEmbeddings)
        .values({ transactionId: ids.anaTx, userId: ANA, embedding, contentHash: "h" }),
    );
    const forged = await failure(
      withUser(db, CARLA, (tx) =>
        tx
          .insert(transactionEmbeddings)
          .values({ transactionId: ids.anaSharedTx, userId: ANA, embedding, contentHash: "h" }),
      ),
    );
    expect(forged).toMatch(/row-level security/);
    expect(await withUser(db, CARLA, (tx) => tx.select().from(transactionEmbeddings))).toEqual([]);
    const [nearest] = await withUser(db, ANA, (tx) =>
      tx.execute(sql`SELECT transaction_id, embedding <=> ${JSON.stringify(embedding)}::vector AS d
        FROM app.transaction_embeddings`),
    ).then((r) => (r as unknown as { rows: { transaction_id: string; d: number }[] }).rows);
    expect(nearest).toMatchObject({ transaction_id: ids.anaTx, d: 0 });
  });
});
