import type {
  AccountRecord,
  CategoryRecord,
  SyncEntity,
  SyncRecord,
  TransactionRecord,
} from "@lukas/sync";
import { isUuid, syncId } from "@lukas/sync";
import type { SqlConnection } from "../data/sql";

/**
 * Traducción entre ids del teléfono y del servidor. Los UUID son iguales en ambos lados; los
 * demás (categorías por defecto como `default.mercado`) se convierten con `syncId`, y al bajar
 * se buscan en este mapa para volver al id local.
 */
export interface IdMap {
  toServer(localId: string): string;
  toLocal(serverId: string): string;
}

export async function idMap(db: SqlConnection, userId: string): Promise<IdMap> {
  const back = new Map<string, string>();
  for (const table of ["accounts", "categories", "transactions"] as const) {
    const rows = await db.all<{ id: string }>(`SELECT id FROM ${table}`);
    for (const { id } of rows) if (!isUuid(id)) back.set(syncId(userId, id), id);
  }
  return {
    toServer: (id) => syncId(userId, id),
    toLocal: (id) => back.get(id) ?? id,
  };
}

const nullableId = (ids: IdMap, id: string | null) => (id === null ? null : ids.toServer(id));

interface AccountRow {
  id: string;
  name: string;
  type: AccountRecord["type"];
  currency: string;
  institution: string | null;
  last4: string | null;
  closing_day: number | null;
  due_day: number | null;
  credit_limit_minor: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  kind: CategoryRecord["kind"];
  icon: string | null;
  color: string | null;
  is_system: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TransactionRow {
  id: string;
  occurred_at: string;
  description: string;
  merchant: string | null;
  notes: string | null;
  status: TransactionRecord["status"];
  source: TransactionRecord["source"];
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface EntryRow {
  id: string;
  account_id: string | null;
  category_id: string | null;
  amount_minor: number;
  currency: string;
}

/** Estado actual de un registro local como lo entiende el servidor, o `null` si ya no existe. */
export async function localRecord(
  db: SqlConnection,
  ids: IdMap,
  entity: SyncEntity,
  id: string,
): Promise<SyncRecord | null> {
  if (entity === "accounts") {
    const r = await db.get<AccountRow>("SELECT * FROM accounts WHERE id = ?", id);
    return r
      ? {
          id: ids.toServer(r.id),
          name: r.name,
          type: r.type,
          currency: r.currency,
          institution: r.institution,
          last4: r.last4,
          closingDay: r.closing_day,
          dueDay: r.due_day,
          creditLimitMinor: r.credit_limit_minor === null ? null : String(r.credit_limit_minor),
          archivedAt: r.archived_at,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }
      : null;
  }
  if (entity === "categories") {
    const r = await db.get<CategoryRow>("SELECT * FROM categories WHERE id = ?", id);
    return r
      ? {
          id: ids.toServer(r.id),
          parentId: nullableId(ids, r.parent_id),
          name: r.name,
          kind: r.kind,
          icon: r.icon,
          color: r.color,
          isSystem: r.is_system === 1,
          archivedAt: r.archived_at,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        }
      : null;
  }
  const t = await db.get<TransactionRow>("SELECT * FROM transactions WHERE id = ?", id);
  if (!t) return null;
  const lines = await db.all<EntryRow>(
    "SELECT * FROM entries WHERE transaction_id = ? ORDER BY id",
    id,
  );
  return {
    id: ids.toServer(t.id),
    occurredAt: t.occurred_at,
    description: t.description,
    merchant: t.merchant,
    notes: t.notes,
    status: t.status,
    source: t.source,
    deletedAt: t.deleted_at,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    entries: lines.map((e) => ({
      id: ids.toServer(e.id),
      accountId: nullableId(ids, e.account_id),
      categoryId: nullableId(ids, e.category_id),
      amountMinor: String(e.amount_minor),
      currency: e.currency,
    })),
  };
}
