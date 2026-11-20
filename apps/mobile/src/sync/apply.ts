import type { Change, SyncEntity, SyncRecord } from "@lukas/sync";
import { searchText } from "../data/ledger-sqlite";
import type { SqlConnection } from "../data/sql";
import type { IdMap } from "./records";

const toInt = (minor: string): number => {
  const n = Number(minor);
  if (!Number.isSafeInteger(n)) throw new Error(`Monto fuera de rango: ${minor}`);
  return n;
};

const setVersion = (tx: SqlConnection, entity: SyncEntity, id: string, version: number) =>
  tx.run(
    `INSERT INTO sync_versions (entity, entity_id, version) VALUES (?, ?, ?)
     ON CONFLICT (entity, entity_id) DO UPDATE SET version = excluded.version`,
    entity,
    id,
    version,
  );

/** Escribe un registro del servidor en la base local (sin pasar por la cola de subida). */
async function upsertLocal(
  tx: SqlConnection,
  ids: IdMap,
  entity: SyncEntity,
  record: SyncRecord,
  version: number,
): Promise<void> {
  const id = ids.toLocal(record.id);
  if (entity === "accounts" && "type" in record) {
    await tx.run(
      `INSERT INTO accounts (id, name, type, currency, institution, last4, closing_day, due_day,
         credit_limit_minor, archived_at, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, type = excluded.type,
         currency = excluded.currency, institution = excluded.institution, last4 = excluded.last4,
         closing_day = excluded.closing_day, due_day = excluded.due_day,
         credit_limit_minor = excluded.credit_limit_minor, archived_at = excluded.archived_at,
         updated_at = excluded.updated_at, version = excluded.version`,
      id,
      record.name,
      record.type,
      record.currency,
      record.institution,
      record.last4,
      record.closingDay,
      record.dueDay,
      record.creditLimitMinor === null ? null : toInt(record.creditLimitMinor),
      record.archivedAt,
      record.createdAt,
      record.updatedAt,
      version,
    );
  } else if (entity === "categories" && "kind" in record) {
    // `budget_group` es solo del teléfono: no se toca.
    await tx.run(
      `INSERT INTO categories (id, parent_id, name, kind, icon, color, is_system, archived_at,
         created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name,
         kind = excluded.kind, icon = excluded.icon, color = excluded.color,
         is_system = excluded.is_system, archived_at = excluded.archived_at,
         updated_at = excluded.updated_at, version = excluded.version`,
      id,
      record.parentId === null ? null : ids.toLocal(record.parentId),
      record.name,
      record.kind,
      record.icon,
      record.color,
      record.isSystem ? 1 : 0,
      record.archivedAt,
      record.createdAt,
      record.updatedAt,
      version,
    );
  } else if (entity === "transactions" && "entries" in record) {
    await tx.run(
      `INSERT INTO transactions (id, occurred_at, description, merchant, notes, search_text, status,
         source, deleted_at, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET occurred_at = excluded.occurred_at,
         description = excluded.description, merchant = excluded.merchant, notes = excluded.notes,
         search_text = excluded.search_text, status = excluded.status, source = excluded.source,
         deleted_at = excluded.deleted_at, updated_at = excluded.updated_at,
         version = excluded.version`,
      id,
      record.occurredAt,
      record.description,
      record.merchant,
      record.notes,
      searchText(record),
      record.status,
      record.source,
      record.deletedAt,
      record.createdAt,
      record.updatedAt,
      version,
    );
    await tx.run("DELETE FROM entries WHERE transaction_id = ?", id);
    for (const e of record.entries) {
      await tx.run(
        `INSERT INTO entries (id, transaction_id, account_id, category_id, amount_minor, currency)
         VALUES (?, ?, ?, ?, ?, ?)`,
        e.id,
        id,
        e.accountId === null ? null : ids.toLocal(e.accountId),
        e.categoryId === null ? null : ids.toLocal(e.categoryId),
        toInt(e.amountMinor),
        e.currency,
      );
    }
  } else {
    throw new Error(`Registro que no corresponde a ${entity}`);
  }
  await setVersion(tx, entity, id, version);
}

async function deleteLocal(tx: SqlConnection, ids: IdMap, entity: SyncEntity, serverId: string) {
  const id = ids.toLocal(serverId);
  if (entity === "transactions") {
    await tx.run("DELETE FROM transactions WHERE id = ?", id);
  } else {
    // Una cuenta o categoría que aún tiene asientos en el teléfono no se borra: se archiva.
    const column = entity === "accounts" ? "account_id" : "category_id";
    const used = await tx.get(`SELECT 1 FROM entries WHERE ${column} = ? LIMIT 1`, id);
    if (used) {
      await tx.run(
        `UPDATE ${entity} SET archived_at = coalesce(archived_at, ?) WHERE id = ?`,
        new Date().toISOString(),
        id,
      );
    } else {
      await tx.run(`DELETE FROM ${entity} WHERE id = ?`, id);
    }
  }
  await tx.run("DELETE FROM sync_versions WHERE entity = ? AND entity_id = ?", entity, id);
}

/** Aplica cambios dentro de una transacción ya abierta por `applyChanges`. */
export async function applyInTx(
  tx: SqlConnection,
  ids: IdMap,
  changes: readonly Change[],
): Promise<void> {
  for (const change of changes) {
    if (change.kind === "upsert") {
      await upsertLocal(tx, ids, change.entity, change.record, change.version);
    } else {
      await deleteLocal(tx, ids, change.entity, change.id);
    }
  }
}

/**
 * Aplica cambios del servidor en una transacción. `applying = 1` apaga los triggers de la cola
 * y las llaves foráneas se revisan al final, así el orden dentro del lote no importa.
 */
export async function applyChanges(
  db: SqlConnection,
  ids: IdMap,
  changes: readonly Change[],
  extra?: (tx: SqlConnection) => Promise<void>,
): Promise<void> {
  if (changes.length === 0 && !extra) return;
  await db.transaction(async (tx) => {
    await tx.exec("PRAGMA defer_foreign_keys = ON");
    await tx.run("UPDATE sync_state SET applying = 1");
    await applyInTx(tx, ids, changes);
    if (extra) await extra(tx);
    await tx.run("UPDATE sync_state SET applying = 0");
  });
}
