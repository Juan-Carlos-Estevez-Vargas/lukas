import {
  DomainError,
  type Money,
  type MovementKind,
  type MovementSplit,
  matchRule,
  merchantKey,
  newSplitMovement,
  type Result,
  suggestFromHistory,
  type Transaction,
  type TransactionSource,
} from "@lukas/domain";
import type { Clock } from "../accounts/accounts";
import { sqliteAccounts, sqliteRepositories } from "../data/ledger-sqlite";
import { sqlitePreferences } from "../data/preferences";
import type { SqlConnection } from "../data/sql";
import { learnCorrection, listRules } from "./categories";
import { ruleCategoryFor } from "./merchant-rules";
import { tagTransaction } from "./tags";

export interface Category {
  readonly id: string;
  readonly name: string;
  readonly kind: MovementKind;
  readonly icon: string | null;
}

/** Categorías activas de un tipo, primero las más usadas en los últimos 90 días. */
export async function listCategories(
  db: SqlConnection,
  kind: MovementKind,
  now: Date,
): Promise<Category[]> {
  const since = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  return db.all<Category>(
    `SELECT c.id, c.name, c.kind, c.icon
     FROM categories c
     LEFT JOIN entries e ON e.category_id = c.id
     LEFT JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL
       AND t.occurred_at >= ?
     WHERE c.kind = ? AND c.archived_at IS NULL AND c.is_system = 0
     GROUP BY c.id
     ORDER BY count(t.id) DESC, c.name`,
    since,
    kind,
  );
}

export interface NewMovement {
  readonly kind: MovementKind;
  readonly accountId: string;
  /** Categoría única. Se ignora si hay `splits`. */
  readonly categoryId: string;
  /** Movimiento dividido: cuánto va a cada categoría; deben sumar `amount`. */
  readonly splits?: readonly { readonly categoryId: string; readonly amount: Money }[];
  readonly amount: Money;
  readonly occurredAt: Date;
  readonly merchant?: string | null;
  readonly note?: string | null;
  readonly tags?: readonly string[];
  /** Categoría que la app sugirió; si la persona eligió otra, se aprende. */
  readonly suggestedCategoryId?: string | null;
  /** Foto del recibo ya guardada por el `ReceiptStore`. */
  readonly receipt?: { readonly fileName: string; readonly mimeType: string } | null;
  readonly source?: TransactionSource;
}

interface CategoryRow {
  id: string;
  kind: MovementKind;
  archived_at: string | null;
}

/**
 * Guarda un gasto o ingreso (simple o dividido) con sus etiquetas y recibo, todo en una
 * transacción, y recuerda la cuenta para el siguiente registro.
 */
export async function recordMovement(
  db: SqlConnection,
  input: NewMovement,
  clock: Clock,
): Promise<Result<Transaction, DomainError>> {
  let result: Result<Transaction, DomainError> | undefined;
  await db.transaction(async (tx) => {
    result = await writeMovement(tx, input, clock);
    if (result.ok) await sqlitePreferences(tx).set("movements.lastAccount", input.accountId);
  });
  if (!result) throw new Error("El registro no produjo resultado");
  return result;
}

/** Valida y escribe el movimiento dentro de una transacción ya abierta. */
export async function writeMovement(
  tx: SqlConnection,
  input: NewMovement,
  clock: Clock,
): Promise<Result<Transaction, DomainError>> {
  const account = await sqliteAccounts(tx).get(input.accountId);
  const parts =
    input.splits && input.splits.length > 0
      ? input.splits
      : [{ categoryId: input.categoryId, amount: input.amount }];
  const splits: MovementSplit[] = [];
  for (const part of parts) {
    const row = await tx.get<CategoryRow>(
      "SELECT id, kind, archived_at FROM categories WHERE id = ?",
      part.categoryId,
    );
    if (!row) break;
    splits.push({
      category: {
        id: row.id,
        kind: row.kind,
        archivedAt: row.archived_at ? new Date(row.archived_at) : null,
      },
      amount: part.amount,
    });
  }
  if (!account || splits.length !== parts.length) return { ok: false, error: notFound() };
  const result = newSplitMovement(account, splits, input, clock);
  if (!result.ok) return result;
  const transaction = result.value;
  await sqliteRepositories(tx).transactions.save(transaction);
  await tagTransaction(tx, transaction.id, input.tags ?? [], clock);
  if (input.receipt) {
    await tx.run(
      `INSERT INTO attachments (id, transaction_id, file_name, mime_type, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      clock.newId(),
      transaction.id,
      input.receipt.fileName,
      input.receipt.mimeType,
      clock.now().toISOString(),
    );
  }
  if (input.suggestedCategoryId !== undefined && splits.length === 1) {
    await learnCorrection(
      tx,
      transaction.merchant,
      input.suggestedCategoryId,
      input.categoryId,
      clock,
    );
  }
  return result;
}

const notFound = () => new DomainError("not_found", "No existe la cuenta o la categoría");

/** Última cuenta usada, si sigue activa; si no, la primera cuenta activa. */
export async function defaultAccountId(db: SqlConnection): Promise<string | null> {
  const accounts = await sqliteAccounts(db).list();
  const last = await sqlitePreferences(db).get("movements.lastAccount");
  return accounts.find((a) => a.id === last)?.id ?? accounts[0]?.id ?? null;
}

interface MerchantRow {
  readonly merchant: string;
  readonly uses: number;
}

/** Comercios ya usados que contienen lo escrito, los más frecuentes primero. */
export async function merchantSuggestions(
  db: SqlConnection,
  text: string,
  limit = 5,
): Promise<string[]> {
  const typed = merchantKey(text);
  if (typed.length === 0) return [];
  const rows = await db.all<MerchantRow>(
    `SELECT merchant, count(*) AS uses FROM transactions
     WHERE merchant IS NOT NULL AND deleted_at IS NULL
     GROUP BY merchant ORDER BY uses DESC, max(occurred_at) DESC LIMIT 500`,
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const key = merchantKey(r.merchant);
    if (!key.includes(typed) || key === typed || seen.has(key)) continue;
    seen.add(key);
    out.push(r.merchant);
    if (out.length === limit) break;
  }
  return out;
}

/**
 * Categoría sugerida para un comercio: la que la persona más ha usado con él; si nunca lo ha
 * registrado, la de las reglas de comercios conocidos (si esa categoría sigue activa).
 */
export async function suggestCategory(
  db: SqlConnection,
  merchant: string,
  kind: MovementKind,
): Promise<string | null> {
  const key = merchantKey(merchant);
  if (key.length === 0) return null;
  // 1. Reglas: las de la persona y las aprendidas de sus correcciones.
  const rule = matchRule(await listRules(db, kind), { merchant });
  if (rule) return rule.categoryId;
  // 2. Historial con ese comercio.
  const rows = await db.all<{ merchant: string; category_id: string; occurred_at: string }>(
    `SELECT t.merchant, e.category_id, t.occurred_at
     FROM transactions t
     JOIN entries e ON e.transaction_id = t.id AND e.category_id IS NOT NULL
     JOIN categories c ON c.id = e.category_id
     WHERE t.merchant IS NOT NULL AND t.deleted_at IS NULL AND c.kind = ?
       AND c.archived_at IS NULL
     ORDER BY t.occurred_at DESC LIMIT 2000`,
    kind,
  );
  const fromHistory = suggestFromHistory(
    rows
      .filter((r) => merchantKey(r.merchant) === key)
      .map((r) => ({ categoryId: r.category_id, occurredAt: new Date(r.occurred_at) })),
  );
  if (fromHistory) return fromHistory;
  // 3. Comercios colombianos conocidos.
  const known = ruleCategoryFor(merchant);
  if (!known) return null;
  const active = await db.get<{ id: string }>(
    "SELECT id FROM categories WHERE id = ? AND kind = ? AND archived_at IS NULL",
    known,
    kind,
  );
  return active?.id ?? null;
}

/**
 * Cambia la categoría de un gasto o ingreso de una sola categoría y aprende de la corrección para
 * ese comercio. Los divididos y las transferencias no se tocan aquí.
 */
export async function recategorize(
  db: SqlConnection,
  transactionId: string,
  categoryId: string,
  clock: Clock,
): Promise<Result<true, DomainError>> {
  let result: Result<true, DomainError> = { ok: false, error: notFound() };
  await db.transaction(async (tx) => {
    const entries = await tx.all<{ id: string; category_id: string; kind: string }>(
      `SELECT e.id, e.category_id, c.kind FROM entries e JOIN categories c ON c.id = e.category_id
       WHERE e.transaction_id = ?`,
      transactionId,
    );
    const target = await tx.get<{ kind: string }>(
      "SELECT kind FROM categories WHERE id = ? AND archived_at IS NULL AND is_system = 0",
      categoryId,
    );
    const only = entries.length === 1 ? entries[0] : undefined;
    if (!only || !target) return;
    if (only.kind !== target.kind) {
      result = { ok: false, error: new DomainError("invalid_category", "Otro tipo de categoría") };
      return;
    }
    const t = await tx.get<{ merchant: string | null }>(
      "SELECT merchant FROM transactions WHERE id = ?",
      transactionId,
    );
    await tx.run("UPDATE entries SET category_id = ? WHERE id = ?", categoryId, only.id);
    await tx.run(
      "UPDATE transactions SET updated_at = ?, version = version + 1 WHERE id = ?",
      clock.now().toISOString(),
      transactionId,
    );
    await learnCorrection(tx, t?.merchant ?? null, only.category_id, categoryId, clock);
    result = { ok: true, value: true };
  });
  return result;
}
