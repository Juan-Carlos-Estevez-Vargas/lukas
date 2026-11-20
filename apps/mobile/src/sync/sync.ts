import {
  MAX_OPS_PER_PUSH,
  mergeRecords,
  type Operation,
  type OpResult,
  type SyncEntity,
  type SyncRecord,
  syncId,
} from "@lukas/sync";
import type { SqlConnection } from "../data/sql";
import { applyChanges, setVersion, upsertLocal } from "./apply";
import type { SyncApi } from "./client";
import { type IdMap, idMap, localRecord } from "./records";

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

const enqueue = (tx: SqlConnection, entity: SyncEntity, id: string) =>
  tx.run("INSERT INTO sync_outbox (entity, entity_id) VALUES (?, ?)", entity, id);

const logConflict = (
  tx: SqlConnection,
  p: Pending,
  field: string,
  local: unknown,
  server: unknown,
  kept: "local" | "server",
  now: () => Date,
) =>
  tx.run(
    `INSERT INTO sync_conflicts (entity, entity_id, field, local_value, server_value, kept, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    p.entity,
    p.entityId,
    field,
    JSON.stringify(local ?? null),
    JSON.stringify(server ?? null),
    kept,
    now().toISOString(),
  );

/**
 * El servidor tenía otra versión (FIN-203). Se fusiona campo por campo con la última versión
 * conocida: lo que cambió un solo lado se conserva; lo que cambiaron ambos lo decide la edición
 * más reciente y queda en `sync_conflicts`. Si el resultado difiere del servidor, se vuelve a
 * subir en la siguiente vuelta. Un borrado contra una edición: gana la edición.
 * Devuelve cuántos campos estaban en conflicto de verdad.
 */
async function resolveConflict(
  tx: SqlConnection,
  ids: IdMap,
  p: Pending,
  op: Operation,
  result: Extract<OpResult, { status: "conflict" }>,
  now: () => Date,
): Promise<number> {
  const local = op.kind === "upsert" ? op.record : null;
  const server = result.current;
  if (local && server) {
    const row = await tx.get<{ base: string | null }>(
      "SELECT base FROM sync_versions WHERE entity = ? AND entity_id = ?",
      p.entity,
      p.entityId,
    );
    const base = row?.base ? (JSON.parse(row.base) as SyncRecord) : null;
    const { merged, conflicts } = mergeRecords(base, local, server);
    for (const c of conflicts) await logConflict(tx, p, c.field, c.local, c.server, c.kept, now);
    await upsertLocal(tx, ids, p.entity, merged, result.version);
    await setVersion(tx, p.entity, p.entityId, result.version, server);
    if (JSON.stringify(merged) !== JSON.stringify(server)) await enqueue(tx, p.entity, p.entityId);
    return conflicts.length;
  }
  if (local) {
    // Se borró en otro dispositivo pero aquí se editó: se conserva y se vuelve a crear.
    await logConflict(tx, p, "_deleted", false, true, "local", now);
    await tx.run(
      "DELETE FROM sync_versions WHERE entity = ? AND entity_id = ?",
      p.entity,
      p.entityId,
    );
    await enqueue(tx, p.entity, p.entityId);
    return 1;
  }
  if (server) {
    // Aquí se borró pero en otro dispositivo se editó: se recupera la edición.
    await logConflict(tx, p, "_deleted", true, false, "server", now);
    await upsertLocal(tx, ids, p.entity, server, result.version);
    return 1;
  }
  await tx.run(
    "DELETE FROM sync_versions WHERE entity = ? AND entity_id = ?",
    p.entity,
    p.entityId,
  );
  return 0;
}

/**
 * Sube la cola y baja lo nuevo. Seguro de repetir: el `opId` sale del teléfono, del registro y
 * del último cambio anotado, así que un reintento tras un corte manda el mismo id y el servidor no duplica.
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
    const device =
      (await db.get<{ device_id: string }>("SELECT device_id FROM sync_state"))?.device_id ?? "";

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const batch = await pending(db, MAX_OPS_PER_PUSH);
      if (batch.length === 0) break;
      const ops: Operation[] = [];
      for (const p of batch) {
        const opId = syncId(userId, `op:${device}:${p.entity}:${p.entityId}:${p.upTo}`);
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
            if (op.kind === "upsert") {
              await setVersion(tx, p.entity, p.entityId, result.version, op.record);
            } else {
              await tx.run(
                "DELETE FROM sync_versions WHERE entity = ? AND entity_id = ?",
                p.entity,
                p.entityId,
              );
            }
          } else if (result.status === "conflict") {
            conflicts += await resolveConflict(tx, ids, p, op, result, now);
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
