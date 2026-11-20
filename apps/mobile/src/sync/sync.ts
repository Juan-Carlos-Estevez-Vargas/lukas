import {
  type Change,
  MAX_OPS_PER_PUSH,
  type Operation,
  type SyncEntity,
  syncId,
} from "@lukas/sync";
import type { SqlConnection } from "../data/sql";
import { applyChanges, applyInTx } from "./apply";
import type { SyncApi } from "./client";
import { idMap, localRecord } from "./records";

export interface SyncSummary {
  readonly pushed: number;
  readonly pulled: number;
  readonly rejected: number;
  readonly conflicts: number;
}

interface Pending {
  readonly entity: SyncEntity;
  readonly entityId: string;
  readonly upTo: number;
}

const MAX_ROUNDS = 50;

/** Cambios pendientes, uno por registro, en el orden en que se hicieron por primera vez. */
const pending = (db: SqlConnection, limit: number) =>
  db.all<Pending>(
    `SELECT entity, entity_id AS entityId, max(seq) AS upTo FROM sync_outbox
     GROUP BY entity, entity_id ORDER BY min(seq) LIMIT ?`,
    limit,
  );

const versionOf = async (db: SqlConnection, entity: SyncEntity, id: string) =>
  (
    await db.get<{ version: number }>(
      "SELECT version FROM sync_versions WHERE entity = ? AND entity_id = ?",
      entity,
      id,
    )
  )?.version ?? null;

/**
 * Sube la cola y baja lo nuevo. Seguro de repetir: el `opId` sale del registro y del último
 * cambio anotado, así que un reintento tras un corte manda el mismo id y el servidor no duplica.
 */
export async function syncNow(
  db: SqlConnection,
  api: SyncApi,
  userId: string,
  now: () => Date = () => new Date(),
): Promise<SyncSummary> {
  let pushed = 0;
  let pulled = 0;
  let rejected = 0;
  let conflicts = 0;
  try {
    const ids = await idMap(db, userId);

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const batch = await pending(db, MAX_OPS_PER_PUSH);
      if (batch.length === 0) break;
      const ops: Operation[] = [];
      for (const p of batch) {
        const opId = syncId(userId, `op:${p.entity}:${p.entityId}:${p.upTo}`);
        const baseVersion = await versionOf(db, p.entity, p.entityId);
        const record = await localRecord(db, ids, p.entity, p.entityId);
        ops.push(
          record
            ? ({ opId, entity: p.entity, kind: "upsert", baseVersion, record } as Operation)
            : { opId, entity: p.entity, kind: "delete", id: ids.toServer(p.entityId), baseVersion },
        );
      }
      const { results } = await api.push(ops);
      await applyChanges(db, ids, [], async (tx) => {
        for (const [i, result] of results.entries()) {
          const p = batch[i];
          const op = ops[i];
          if (!p || !op || result.opId !== op.opId) continue;
          if (result.status === "applied" || result.status === "duplicate") {
            pushed += 1;
            await tx.run(
              `INSERT INTO sync_versions (entity, entity_id, version) VALUES (?, ?, ?)
               ON CONFLICT (entity, entity_id) DO UPDATE SET version = excluded.version`,
              p.entity,
              p.entityId,
              result.version,
            );
          } else if (result.status === "conflict") {
            // Por ahora gana el servidor (FIN-203 resolverá campo por campo).
            conflicts += 1;
            const server: Change = result.current
              ? ({
                  entity: p.entity,
                  kind: "upsert",
                  version: result.version,
                  record: result.current,
                } as Change)
              : { entity: p.entity, kind: "delete", id: ids.toServer(p.entityId) };
            await applyInTx(tx, ids, [server]);
          } else {
            rejected += 1;
            await tx.run("UPDATE sync_state SET last_error = ?", `${p.entity}:${result.reason}`);
          }
          await tx.run(
            "DELETE FROM sync_outbox WHERE entity = ? AND entity_id = ? AND seq <= ?",
            p.entity,
            p.entityId,
            p.upTo,
          );
        }
      });
    }

    let state = await db.get<{ cursor: string }>("SELECT cursor FROM sync_state");
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const page = await api.pull(state?.cursor ?? "0");
      const fresh = await idMap(db, userId);
      await applyChanges(db, fresh, page.changes, (tx) =>
        tx.run("UPDATE sync_state SET cursor = ?", page.cursor),
      );
      pulled += page.changes.length;
      state = { cursor: page.cursor };
      if (!page.hasMore) break;
    }

    await db.run(
      "UPDATE sync_state SET last_synced_at = ?, last_error = CASE WHEN ? > 0 THEN last_error END",
      now().toISOString(),
      rejected,
    );
  } catch (error) {
    await db
      .run("UPDATE sync_state SET last_error = ?", error instanceof Error ? error.message : "error")
      .catch(() => undefined);
    throw error;
  }
  return { pushed, pulled, rejected, conflicts };
}

export interface SyncStatus {
  readonly pending: number;
  readonly lastSyncedAt: string | null;
  readonly lastError: string | null;
}

export async function syncStatus(db: SqlConnection): Promise<SyncStatus> {
  const state = await db.get<{ last_synced_at: string | null; last_error: string | null }>(
    "SELECT last_synced_at, last_error FROM sync_state",
  );
  const count = await db.get<{ n: number }>(
    "SELECT count(DISTINCT entity || ':' || entity_id) AS n FROM sync_outbox",
  );
  return {
    pending: count?.n ?? 0,
    lastSyncedAt: state?.last_synced_at ?? null,
    lastError: state?.last_error ?? null,
  };
}
