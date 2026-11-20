/**
 * Protocolo de sincronización (FIN-202). El teléfono es local-first: guarda todo en SQLite y,
 * cuando hay red, empuja sus cambios (`push`) y trae los de otros dispositivos (`pull`).
 *
 * - Cada operación lleva un `opId` único: reenviarla no la aplica dos veces (idempotencia).
 * - Cada registro tiene `version` en el servidor; el cliente manda la que conoce (`baseVersion`).
 *   Si no coincide, el servidor responde `conflict` con su versión (FIN-203 resuelve por campo).
 * - `pull` lee el registro de cambios del usuario desde un cursor opaco.
 * Los montos viajan como texto decimal de unidades menores (bigint), nunca como número.
 */

export const SYNC_ENTITIES = ["accounts", "categories", "transactions"] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export const ACCOUNT_TYPES = [
  "cash",
  "bank",
  "digital_wallet",
  "credit_card",
  "loan",
  "investment",
  "other_asset",
  "other_liability",
] as const;
export const CATEGORY_KINDS = ["income", "expense", "equity", "trading"] as const;
export const TRANSACTION_STATUSES = ["pending", "cleared", "reconciled"] as const;
export const TRANSACTION_SOURCES = [
  "manual",
  "notification",
  "statement",
  "receipt",
  "email",
  "import",
  "recurring",
] as const;

export interface AccountRecord {
  readonly id: string;
  readonly name: string;
  readonly type: (typeof ACCOUNT_TYPES)[number];
  readonly currency: string;
  readonly institution: string | null;
  readonly last4: string | null;
  readonly closingDay: number | null;
  readonly dueDay: number | null;
  readonly creditLimitMinor: string | null;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CategoryRecord {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly kind: (typeof CATEGORY_KINDS)[number];
  readonly icon: string | null;
  readonly color: string | null;
  readonly isSystem: boolean;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EntryRecord {
  readonly id: string;
  readonly accountId: string | null;
  readonly categoryId: string | null;
  readonly amountMinor: string;
  readonly currency: string;
}

export interface TransactionRecord {
  readonly id: string;
  readonly occurredAt: string;
  readonly description: string;
  readonly merchant: string | null;
  readonly notes: string | null;
  readonly status: (typeof TRANSACTION_STATUSES)[number];
  readonly source: (typeof TRANSACTION_SOURCES)[number];
  readonly deletedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly entries: readonly EntryRecord[];
}

export interface RecordOf {
  readonly accounts: AccountRecord;
  readonly categories: CategoryRecord;
  readonly transactions: TransactionRecord;
}

export type SyncRecord = RecordOf[SyncEntity];

export type Upsert = {
  [E in SyncEntity]: {
    readonly opId: string;
    readonly entity: E;
    readonly kind: "upsert";
    /** Versión del servidor que conoce el cliente; `null` si nunca lo ha subido. */
    readonly baseVersion: number | null;
    readonly record: RecordOf[E];
  };
}[SyncEntity];

export interface Delete {
  readonly opId: string;
  readonly entity: SyncEntity;
  readonly kind: "delete";
  readonly id: string;
  readonly baseVersion: number | null;
}

export type Operation = Upsert | Delete;

export const MAX_OPS_PER_PUSH = 100;

export interface PushRequest {
  readonly ops: readonly Operation[];
}

export type OpResult =
  | { readonly opId: string; readonly status: "applied"; readonly version: number }
  /** El `opId` ya se había aplicado: se devuelve el resultado guardado. */
  | { readonly opId: string; readonly status: "duplicate"; readonly version: number }
  /** La versión del servidor cambió: el cliente recibe la vigente (o `null` si se borró). */
  | {
      readonly opId: string;
      readonly status: "conflict";
      readonly version: number;
      readonly current: SyncRecord | null;
    }
  /** Datos inválidos para el servidor (p. ej. asientos que no cuadran). No se reintenta. */
  | { readonly opId: string; readonly status: "rejected"; readonly reason: string };

export interface PushResponse {
  readonly results: readonly OpResult[];
}

export type Change =
  | {
      [E in SyncEntity]: {
        readonly entity: E;
        readonly kind: "upsert";
        readonly version: number;
        readonly record: RecordOf[E];
      };
    }[SyncEntity]
  | { readonly entity: SyncEntity; readonly kind: "delete"; readonly id: string };

export interface PullResponse {
  readonly changes: readonly Change[];
  /** Cursor para la siguiente llamada. */
  readonly cursor: string;
  readonly hasMore: boolean;
}

export const PULL_LIMIT = 500;

/** El cursor es el último `seq` visto, en texto para no depender de números de 53 bits. */
export const parseCursor = (cursor: string | undefined | null): bigint | null => {
  if (cursor === undefined || cursor === null || cursor === "") return 0n;
  return /^\d{1,19}$/.test(cursor) ? BigInt(cursor) : null;
};
