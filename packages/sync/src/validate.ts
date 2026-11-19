import {
  ACCOUNT_TYPES,
  type AccountRecord,
  CATEGORY_KINDS,
  type CategoryRecord,
  type EntryRecord,
  MAX_OPS_PER_PUSH,
  type Operation,
  type PushRequest,
  SYNC_ENTITIES,
  type SyncEntity,
  TRANSACTION_SOURCES,
  TRANSACTION_STATUSES,
  type TransactionRecord,
} from "./protocol";

/** Error de validación con la ruta del campo, p. ej. `ops[3].record.entries[0].amountMinor`. */
export class SyncValidationError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "SyncValidationError";
  }
}

type Obj = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINOR = /^-?\d{1,19}$/;
const CURRENCY = /^[A-Z]{3}$/;
const LAST4 = /^\d{4}$/;
const MAX_TEXT = 500;

const fail = (path: string, message: string): never => {
  throw new SyncValidationError(path, message);
};

const obj = (v: unknown, path: string): Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : fail(path, "objeto");

const str = (o: Obj, key: string, path: string, max = MAX_TEXT): string => {
  const v = o[key];
  if (typeof v !== "string" || v.length > max) return fail(`${path}.${key}`, "texto");
  return v;
};

const optStr = (o: Obj, key: string, path: string, max = MAX_TEXT): string | null =>
  o[key] === null ? null : str(o, key, path, max);

const uuid = (o: Obj, key: string, path: string): string => {
  const v = str(o, key, path, 36);
  return UUID.test(v) ? v : fail(`${path}.${key}`, "UUID");
};

const optUuid = (o: Obj, key: string, path: string): string | null =>
  o[key] === null ? null : uuid(o, key, path);

const timestamp = (o: Obj, key: string, path: string): string => {
  const v = str(o, key, path, 40);
  return Number.isNaN(Date.parse(v)) ? fail(`${path}.${key}`, "fecha ISO") : v;
};

const optTimestamp = (o: Obj, key: string, path: string): string | null =>
  o[key] === null ? null : timestamp(o, key, path);

const oneOf = <T extends string>(o: Obj, key: string, path: string, values: readonly T[]): T => {
  const v = o[key];
  return typeof v === "string" && (values as readonly string[]).includes(v)
    ? (v as T)
    : fail(`${path}.${key}`, `uno de ${values.join(", ")}`);
};

const day = (o: Obj, key: string, path: string): number | null => {
  const v = o[key];
  if (v === null) return null;
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 31
    ? (v as number)
    : fail(`${path}.${key}`, "día de 1 a 31");
};

const minor = (o: Obj, key: string, path: string): string => {
  const v = str(o, key, path, 20);
  return MINOR.test(v) ? v : fail(`${path}.${key}`, "entero en unidades menores");
};

const currency = (o: Obj, key: string, path: string): string => {
  const v = str(o, key, path, 3);
  return CURRENCY.test(v) ? v : fail(`${path}.${key}`, "código ISO 4217");
};

const name = (o: Obj, key: string, path: string): string => {
  const v = str(o, key, path, 120);
  return v.trim() === "" ? fail(`${path}.${key}`, "no puede estar vacío") : v;
};

const account = (o: Obj, path: string): AccountRecord => {
  const last4 = optStr(o, "last4", path, 4);
  if (last4 !== null && !LAST4.test(last4)) fail(`${path}.last4`, "4 dígitos");
  return {
    id: uuid(o, "id", path),
    name: name(o, "name", path),
    type: oneOf(o, "type", path, ACCOUNT_TYPES),
    currency: currency(o, "currency", path),
    institution: optStr(o, "institution", path, 120),
    last4,
    closingDay: day(o, "closingDay", path),
    dueDay: day(o, "dueDay", path),
    creditLimitMinor: o.creditLimitMinor === null ? null : minor(o, "creditLimitMinor", path),
    archivedAt: optTimestamp(o, "archivedAt", path),
    createdAt: timestamp(o, "createdAt", path),
    updatedAt: timestamp(o, "updatedAt", path),
  };
};

const category = (o: Obj, path: string): CategoryRecord => {
  if (typeof o.isSystem !== "boolean") fail(`${path}.isSystem`, "booleano");
  return {
    id: uuid(o, "id", path),
    parentId: optUuid(o, "parentId", path),
    name: name(o, "name", path),
    kind: oneOf(o, "kind", path, CATEGORY_KINDS),
    icon: optStr(o, "icon", path, 40),
    color: optStr(o, "color", path, 40),
    isSystem: o.isSystem as boolean,
    archivedAt: optTimestamp(o, "archivedAt", path),
    createdAt: timestamp(o, "createdAt", path),
    updatedAt: timestamp(o, "updatedAt", path),
  };
};

const entry = (o: Obj, path: string): EntryRecord => {
  const e: EntryRecord = {
    id: uuid(o, "id", path),
    accountId: optUuid(o, "accountId", path),
    categoryId: optUuid(o, "categoryId", path),
    amountMinor: minor(o, "amountMinor", path),
    currency: currency(o, "currency", path),
  };
  if ((e.accountId === null) === (e.categoryId === null)) {
    fail(path, "cada asiento toca una cuenta o una categoría");
  }
  if (BigInt(e.amountMinor) === 0n) fail(`${path}.amountMinor`, "no puede ser cero");
  return e;
};

/** Doble partida: al menos dos asientos y, por cada moneda, suma cero. */
export const isBalanced = (entries: readonly EntryRecord[]): boolean => {
  if (entries.length < 2) return false;
  const sums = new Map<string, bigint>();
  for (const e of entries)
    sums.set(e.currency, (sums.get(e.currency) ?? 0n) + BigInt(e.amountMinor));
  return [...sums.values()].every((s) => s === 0n);
};

const transaction = (o: Obj, path: string): TransactionRecord => {
  const list = o.entries;
  if (!Array.isArray(list) || list.length > 50) return fail(`${path}.entries`, "lista de asientos");
  const entries = list.map((e, i) =>
    entry(obj(e, `${path}.entries[${i}]`), `${path}.entries[${i}]`),
  );
  if (!isBalanced(entries)) fail(`${path}.entries`, "los asientos no cuadran");
  return {
    id: uuid(o, "id", path),
    occurredAt: timestamp(o, "occurredAt", path),
    description: str(o, "description", path),
    merchant: optStr(o, "merchant", path, 120),
    notes: optStr(o, "notes", path, 1000),
    status: oneOf(o, "status", path, TRANSACTION_STATUSES),
    source: oneOf(o, "source", path, TRANSACTION_SOURCES),
    deletedAt: optTimestamp(o, "deletedAt", path),
    createdAt: timestamp(o, "createdAt", path),
    updatedAt: timestamp(o, "updatedAt", path),
    entries,
  };
};

const parseRecord = (entity: SyncEntity, o: Obj, path: string) => {
  switch (entity) {
    case "accounts":
      return account(o, path);
    case "categories":
      return category(o, path);
    case "transactions":
      return transaction(o, path);
  }
};

const baseVersion = (o: Obj, path: string): number | null => {
  const v = o.baseVersion;
  if (v === null) return null;
  return Number.isInteger(v) && (v as number) >= 1
    ? (v as number)
    : fail(`${path}.baseVersion`, "entero ≥ 1 o null");
};

const operation = (raw: unknown, path: string): Operation => {
  const o = obj(raw, path);
  const opId = uuid(o, "opId", path);
  const entity = oneOf(o, "entity", path, SYNC_ENTITIES);
  const kind = oneOf(o, "kind", path, ["upsert", "delete"] as const);
  if (kind === "delete")
    return { opId, entity, kind, id: uuid(o, "id", path), baseVersion: baseVersion(o, path) };
  const record = parseRecord(entity, obj(o.record, `${path}.record`), `${path}.record`);
  return { opId, entity, kind, baseVersion: baseVersion(o, path), record } as Operation;
};

/** Valida el cuerpo de `POST /v1/sync/push`. Lanza `SyncValidationError` con el campo culpable. */
export const parsePushRequest = (body: unknown): PushRequest => {
  const o = obj(body, "body");
  if (!Array.isArray(o.ops) || o.ops.length === 0 || o.ops.length > MAX_OPS_PER_PUSH) {
    return fail("ops", `entre 1 y ${MAX_OPS_PER_PUSH} operaciones`);
  }
  const ops = o.ops.map((op, i) => operation(op, `ops[${i}]`));
  if (new Set(ops.map((op) => op.opId)).size !== ops.length) fail("ops", "opId repetido");
  return { ops };
};
