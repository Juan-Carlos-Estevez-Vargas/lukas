import {
  type Account,
  type AccountRepository,
  type AccountType,
  type CurrencyCode,
  checkBalanced,
  type Entry,
  isCurrencyCode,
  type LedgerRepositories,
  Money,
  merchantKey,
  type Transaction,
  type TransactionRepository,
  type TransactionSource,
  type TransactionStatus,
  type UnitOfWork,
} from "@lukas/domain";
import type { SqlConnection } from "./sql";

/**
 * Montos: en el dominio son `bigint`; expo-sqlite solo enlaza `number`. Un INTEGER de SQLite
 * cabe en `number` sin perder precisión hasta 2^53 (9 × 10^15 unidades menores).
 */
export function toDbAmount(money: Money): number {
  const n = Number(money.amountMinor);
  if (!Number.isSafeInteger(n)) throw new RangeError("Monto fuera del rango de la base local");
  return n;
}

export function fromDbAmount(value: number, currency: string): Money {
  if (!Number.isSafeInteger(value)) throw new RangeError("Monto corrupto en la base local");
  return Money.ofMinor(BigInt(value), currencyCode(currency));
}

function currencyCode(value: string): CurrencyCode {
  if (!isCurrencyCode(value)) throw new Error(`Moneda desconocida en la base local: ${value}`);
  return value;
}

const iso = (d: Date) => d.toISOString();
const date = (s: string) => new Date(s);
const optDate = (s: string | null) => (s === null ? null : new Date(s));

interface AccountRow {
  id: string;
  name: string;
  type: string;
  currency: string;
  institution: string | null;
  last4: string | null;
  closing_day: number | null;
  due_day: number | null;
  credit_limit_minor: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  name: r.name,
  type: r.type as AccountType,
  currency: currencyCode(r.currency),
  institution: r.institution,
  last4: r.last4,
  closingDay: r.closing_day,
  dueDay: r.due_day,
  creditLimit:
    r.credit_limit_minor === null ? null : fromDbAmount(r.credit_limit_minor, r.currency),
  archivedAt: optDate(r.archived_at),
  createdAt: date(r.created_at),
  updatedAt: date(r.updated_at),
  version: r.version,
});

export function sqliteAccounts(db: SqlConnection): AccountRepository {
  return {
    async get(id) {
      const row = await db.get<AccountRow>("SELECT * FROM accounts WHERE id = ?", id);
      return row ? toAccount(row) : null;
    },
    async list(options) {
      const rows = await db.all<AccountRow>(
        options?.includeArchived
          ? "SELECT * FROM accounts ORDER BY name"
          : "SELECT * FROM accounts WHERE archived_at IS NULL ORDER BY name",
      );
      return rows.map(toAccount);
    },
    async save(a) {
      await db.run(
        `INSERT INTO accounts (id, name, type, currency, institution, last4, closing_day, due_day,
           credit_limit_minor, archived_at, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, type = excluded.type,
           currency = excluded.currency, institution = excluded.institution,
           last4 = excluded.last4, closing_day = excluded.closing_day, due_day = excluded.due_day,
           credit_limit_minor = excluded.credit_limit_minor, archived_at = excluded.archived_at,
           updated_at = excluded.updated_at, version = excluded.version`,
        a.id,
        a.name,
        a.type,
        a.currency,
        a.institution,
        a.last4,
        a.closingDay,
        a.dueDay,
        a.creditLimit ? toDbAmount(a.creditLimit) : null,
        a.archivedAt ? iso(a.archivedAt) : null,
        iso(a.createdAt),
        iso(a.updatedAt),
        a.version,
      );
    },
    async balance(a) {
      const row = await db.get<{ total: number }>(
        `SELECT coalesce(sum(e.amount_minor), 0) AS total
         FROM entries e JOIN transactions t ON t.id = e.transaction_id
         WHERE e.account_id = ? AND e.currency = ? AND t.deleted_at IS NULL`,
        a.id,
        a.currency,
      );
      return fromDbAmount(row?.total ?? 0, a.currency);
    },
  };
}

interface TransactionRow {
  id: string;
  occurred_at: string;
  description: string;
  merchant: string | null;
  notes: string | null;
  status: string;
  source: string;
  created_at: string;
  updated_at: string;
  version: number;
}

interface EntryRow {
  id: string;
  account_id: string | null;
  category_id: string | null;
  amount_minor: number;
  currency: string;
}

const toEntry = (r: EntryRow): Entry => ({
  id: r.id,
  target: r.account_id !== null ? { accountId: r.account_id } : { categoryId: r.category_id ?? "" },
  amount: fromDbAmount(r.amount_minor, r.currency),
});

/**
 * Texto de búsqueda sin tildes ni mayúsculas: SQLite solo ignora mayúsculas en ASCII, así que
 * "exito" no encontraría "Éxito" sin esta columna.
 */
export const searchText = (t: Pick<Transaction, "description" | "merchant" | "notes">): string =>
  [t.merchant, t.description, t.notes]
    .filter((v): v is string => Boolean(v))
    .map(merchantKey)
    .join(" | ");

export function sqliteTransactions(db: SqlConnection): TransactionRepository {
  return {
    async get(id) {
      const t = await db.get<TransactionRow>(
        "SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL",
        id,
      );
      if (!t) return null;
      const entries = await db.all<EntryRow>(
        "SELECT id, account_id, category_id, amount_minor, currency FROM entries WHERE transaction_id = ? ORDER BY rowid",
        id,
      );
      return {
        id: t.id,
        occurredAt: date(t.occurred_at),
        description: t.description,
        merchant: t.merchant,
        notes: t.notes,
        status: t.status as TransactionStatus,
        source: t.source as TransactionSource,
        entries: entries.map(toEntry),
        createdAt: date(t.created_at),
        updatedAt: date(t.updated_at),
        version: t.version,
      };
    },
    async save(t: Transaction) {
      // Segunda línea de defensa: SQLite no tiene triggers diferidos para exigir el cuadre.
      const balanced = checkBalanced(t.entries);
      if (!balanced.ok) throw balanced.error;
      await db.run(
        `INSERT INTO transactions (id, occurred_at, description, merchant, notes, search_text,
           status, source, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET occurred_at = excluded.occurred_at,
           description = excluded.description, merchant = excluded.merchant,
           notes = excluded.notes, search_text = excluded.search_text, status = excluded.status,
           source = excluded.source, updated_at = excluded.updated_at, version = excluded.version`,
        t.id,
        iso(t.occurredAt),
        t.description,
        t.merchant,
        t.notes,
        searchText(t),
        t.status,
        t.source,
        iso(t.createdAt),
        iso(t.updatedAt),
        t.version,
      );
      await db.run("DELETE FROM entries WHERE transaction_id = ?", t.id);
      for (const e of t.entries) {
        await db.run(
          `INSERT INTO entries (id, transaction_id, account_id, category_id, amount_minor, currency)
           VALUES (?, ?, ?, ?, ?, ?)`,
          e.id,
          t.id,
          "accountId" in e.target ? e.target.accountId : null,
          "categoryId" in e.target ? e.target.categoryId : null,
          toDbAmount(e.amount),
          e.amount.currencyCode,
        );
      }
    },
  };
}

export const sqliteRepositories = (db: SqlConnection): LedgerRepositories => ({
  accounts: sqliteAccounts(db),
  transactions: sqliteTransactions(db),
});

/**
 * Unidad de trabajo sobre la conexión cifrada: los repositorios que recibe `work` escriben dentro
 * de una sola transacción de SQLite. Si `work` lanza, nada queda escrito.
 * Un caso de uso que devuelve un error de negocio debe hacerlo antes de escribir, o lanzar.
 */
export function sqliteUnitOfWork(db: SqlConnection): UnitOfWork {
  return {
    async run<T>(work: (repos: LedgerRepositories) => Promise<T>): Promise<T> {
      let result: { value: T } | undefined;
      await db.transaction(async (tx) => {
        result = { value: await work(sqliteRepositories(tx)) };
      });
      if (!result) throw new Error("La unidad de trabajo terminó sin resultado");
      return result.value;
    },
  };
}
