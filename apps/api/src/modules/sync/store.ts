import { withUser } from "@lukas/db";
import {
  accounts,
  categories,
  changes,
  entries,
  idempotencyKeys,
  transactions,
} from "@lukas/db/schema";
import type {
  Change,
  Operation,
  OpResult,
  PullResponse,
  SyncEntity,
  SyncRecord,
} from "@lukas/sync";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { TablesRelationalConfig } from "drizzle-orm/relations";
import {
  accountRecord,
  accountRow,
  categoryRecord,
  categoryRow,
  entryRows,
  transactionRecord,
  transactionRow,
} from "./records";

/** Puerto de almacenamiento del sync: la API no sabe si es Neon o PGlite. */
export interface SyncStore {
  push(userId: string, ops: readonly Operation[]): Promise<OpResult[]>;
  pull(userId: string, cursor: bigint, limit: number): Promise<PullResponse>;
}

const TABLES = { accounts, categories, transactions } as const;

/** Código SQLSTATE de un error de Postgres, venga directo o envuelto por Drizzle. */
const sqlState = (error: unknown): string | undefined => {
  const e = error as { code?: unknown; cause?: { code?: unknown } };
  const code = e.cause?.code ?? e.code;
  return typeof code === "string" ? code : undefined;
};

const REASONS: Record<string, string> = {
  "23505": "id_taken",
  "23503": "missing_or_in_use",
  "23514": "invalid",
  "42501": "forbidden",
  P0001: "invalid",
};

class Conflict extends Error {
  constructor(
    readonly version: number,
    readonly current: SyncRecord | null,
  ) {
    super("conflict");
  }
}

/**
 * Almacén del sync sobre Drizzle. Todo corre dentro de `withUser`, así que RLS garantiza que
 * cada usuario solo lee y escribe lo suyo aunque el código tuviera un error de filtro.
 */
export const drizzleSyncStore = <
  Q extends PgQueryResultHKT,
  Full extends Record<string, unknown>,
  Schema extends TablesRelationalConfig,
>(
  db: PgDatabase<Q, Full, Schema>,
): SyncStore => {
  type Tx = PgTransaction<Q, Full, Schema>;

  const versionOf = async (tx: Tx, entity: SyncEntity, id: string): Promise<number | null> => {
    const table = TABLES[entity];
    const [row] = await tx
      .select({ version: table.version })
      .from(table)
      .where(eq(table.id, id))
      .for("update");
    return row?.version ?? null;
  };

  const recordsOf = async (tx: Tx, entity: SyncEntity, ids: readonly string[]) => {
    const found = new Map<string, { version: number; record: SyncRecord }>();
    if (ids.length === 0) return found;
    if (entity === "accounts") {
      for (const r of await tx
        .select()
        .from(accounts)
        .where(inArray(accounts.id, [...ids]))) {
        found.set(r.id, { version: r.version, record: accountRecord(r) });
      }
    } else if (entity === "categories") {
      for (const r of await tx
        .select()
        .from(categories)
        .where(inArray(categories.id, [...ids]))) {
        found.set(r.id, { version: r.version, record: categoryRecord(r) });
      }
    } else {
      const rows = await tx
        .select()
        .from(transactions)
        .where(inArray(transactions.id, [...ids]));
      const lines = await tx
        .select()
        .from(entries)
        .where(inArray(entries.transactionId, [...ids]))
        .orderBy(asc(entries.id));
      for (const r of rows) {
        const own = lines.filter((l) => l.transactionId === r.id);
        found.set(r.id, { version: r.version, record: transactionRecord(r, own) });
      }
    }
    return found;
  };

  const currentRecord = async (tx: Tx, entity: SyncEntity, id: string) =>
    (await recordsOf(tx, entity, [id])).get(id)?.record ?? null;

  const write = async (tx: Tx, userId: string, op: Operation): Promise<number> => {
    const id = op.kind === "upsert" ? op.record.id : op.id;
    const current = await versionOf(tx, op.entity, id);
    if (current !== null && op.baseVersion !== current) {
      throw new Conflict(current, await currentRecord(tx, op.entity, id));
    }
    if (op.kind === "delete") {
      if (current === null) return 0;
      const table = TABLES[op.entity];
      const deleted = await tx.delete(table).where(eq(table.id, id)).returning({ id: table.id });
      if (deleted.length === 0) throw Object.assign(new Error("forbidden"), { code: "42501" });
      return current + 1;
    }
    const version = (current ?? 0) + 1;
    const bump = { version, updatedAt: new Date(op.record.updatedAt) };
    const forbidden = () => Object.assign(new Error("forbidden"), { code: "42501" });
    switch (op.entity) {
      case "accounts": {
        const row = accountRow(op.record, userId);
        if (current === null) await tx.insert(accounts).values(row);
        else if (
          (
            await tx
              .update(accounts)
              .set({ ...row, ...bump })
              .where(eq(accounts.id, id))
              .returning({ id: accounts.id })
          ).length === 0
        )
          throw forbidden();
        break;
      }
      case "categories": {
        const row = categoryRow(op.record, userId);
        if (current === null) await tx.insert(categories).values(row);
        else if (
          (
            await tx
              .update(categories)
              .set({ ...row, ...bump })
              .where(eq(categories.id, id))
              .returning({ id: categories.id })
          ).length === 0
        )
          throw forbidden();
        break;
      }
      case "transactions": {
        const row = transactionRow(op.record, userId);
        if (current === null) await tx.insert(transactions).values(row);
        else {
          const updated = await tx
            .update(transactions)
            .set({ ...row, ...bump })
            .where(eq(transactions.id, id))
            .returning({ id: transactions.id });
          if (updated.length === 0) throw forbidden();
          await tx.delete(entries).where(eq(entries.transactionId, id));
        }
        await tx.insert(entries).values(entryRows(op.record, userId));
        break;
      }
    }
    return version;
  };

  const applyOne = async (tx: Tx, userId: string, op: Operation): Promise<OpResult> => {
    const key = `sync:${op.opId}`;
    const [seen] = await tx
      .select({ body: idempotencyKeys.responseBody })
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
    if (seen) {
      const stored = seen.body as OpResult;
      return stored.status === "applied" ? { ...stored, status: "duplicate" } : stored;
    }

    let result: OpResult;
    try {
      // Cada operación en su propio savepoint: una inválida no tumba el resto del lote.
      // El cuadre de asientos es un trigger diferido; se fuerza al final de la operación.
      const version = await tx.transaction(async (sp) => {
        await sp.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
        const v = await write(sp, userId, op);
        await sp.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
        return v;
      });
      const id = op.kind === "upsert" ? op.record.id : op.id;
      await tx.insert(changes).values({
        userId,
        entity: op.entity,
        entityId: id,
        op: op.kind === "upsert" ? "upsert" : "delete",
        version,
      });
      result = { opId: op.opId, status: "applied", version };
    } catch (error) {
      if (error instanceof Conflict) {
        // El conflicto no se guarda como definitivo: el cliente reintentará con la versión nueva.
        return {
          opId: op.opId,
          status: "conflict",
          version: error.version,
          current: error.current,
        };
      }
      const reason = REASONS[sqlState(error) ?? ""];
      if (!reason) throw error;
      result = { opId: op.opId, status: "rejected", reason };
    }
    await tx.insert(idempotencyKeys).values({
      userId,
      key,
      requestHash: `${op.entity}:${op.kind}`,
      responseStatus: 200,
      responseBody: result,
    });
    return result;
  };

  return {
    push: (userId, ops) =>
      withUser(db, userId, async (tx) => {
        const results: OpResult[] = [];
        for (const op of ops) results.push(await applyOne(tx, userId, op));
        await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);
        return results;
      }),

    pull: (userId, cursor, limit) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .select()
          .from(changes)
          .where(gt(changes.seq, cursor))
          .orderBy(asc(changes.seq))
          .limit(limit + 1);
        const page = rows.slice(0, limit);
        const hasMore = rows.length > limit;
        // Solo cuenta el último cambio de cada registro dentro de la página.
        const latest = new Map<string, (typeof page)[number]>();
        for (const row of page) {
          const k = `${row.entity}:${row.entityId}`;
          latest.delete(k);
          latest.set(k, row);
        }
        const ordered = [...latest.values()];
        const byEntity = new Map<SyncEntity, string[]>();
        for (const row of ordered) {
          if (row.op !== "upsert") continue;
          const entity = row.entity as SyncEntity;
          byEntity.set(entity, [...(byEntity.get(entity) ?? []), row.entityId]);
        }
        const found = new Map<string, { version: number; record: SyncRecord }>();
        for (const [entity, ids] of byEntity) {
          for (const [id, value] of await recordsOf(tx, entity, ids))
            found.set(`${entity}:${id}`, value);
        }
        const out: Change[] = ordered.map((row) => {
          const entity = row.entity as SyncEntity;
          const current = row.op === "upsert" ? found.get(`${entity}:${row.entityId}`) : undefined;
          // Si se borró después, aunque el último cambio de la página sea un upsert, va el borrado.
          return current
            ? ({
                entity,
                kind: "upsert",
                version: current.version,
                record: current.record,
              } as Change)
            : { entity, kind: "delete", id: row.entityId };
        });
        const last = page.at(-1);
        return { changes: out, cursor: (last ? last.seq : cursor).toString(), hasMore };
      }),
  };
};
