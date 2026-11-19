import {
  DomainError,
  type Money,
  type MovementKind,
  merchantKey,
  newMovement,
  type Result,
  suggestFromHistory,
  type Transaction,
} from "@lukas/domain";
import type { Clock } from "../accounts/accounts";
import { sqliteAccounts, sqliteRepositories } from "../data/ledger-sqlite";
import { sqlitePreferences } from "../data/preferences";
import type { SqlConnection } from "../data/sql";
import { ruleCategoryFor } from "./merchant-rules";

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
  readonly categoryId: string;
  readonly amount: Money;
  readonly occurredAt: Date;
  readonly merchant?: string | null;
  readonly note?: string | null;
}

/** Guarda un gasto o ingreso y recuerda la cuenta para el siguiente registro. */
export async function recordMovement(
  db: SqlConnection,
  input: NewMovement,
  clock: Clock,
): Promise<Result<Transaction, DomainError>> {
  let result: Result<Transaction, DomainError> | undefined;
  await db.transaction(async (tx) => {
    const account = await sqliteAccounts(tx).get(input.accountId);
    const row = await tx.get<{ id: string; kind: MovementKind; archived_at: string | null }>(
      "SELECT id, kind, archived_at FROM categories WHERE id = ?",
      input.categoryId,
    );
    if (!account || !row) {
      result = { ok: false, error: notFound() };
      return;
    }
    const category = {
      id: row.id,
      kind: row.kind,
      archivedAt: row.archived_at ? new Date(row.archived_at) : null,
    };
    result = newMovement(account, category, input, clock);
    if (!result.ok) return;
    await sqliteRepositories(tx).transactions.save(result.value);
    await sqlitePreferences(tx).set("movements.lastAccount", account.id);
  });
  if (!result) throw new Error("El registro no produjo resultado");
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
  const rule = ruleCategoryFor(merchant);
  if (!rule) return null;
  const active = await db.get<{ id: string }>(
    "SELECT id FROM categories WHERE id = ? AND kind = ? AND archived_at IS NULL",
    rule,
    kind,
  );
  return active?.id ?? null;
}
