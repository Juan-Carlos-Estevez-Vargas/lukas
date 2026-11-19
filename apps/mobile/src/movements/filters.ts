import { allOf, type Money, merchantKey, type Specification } from "@lukas/domain";
import type { SqlValue } from "../data/sql";

export type ListKind = "expense" | "income" | "transfer" | "adjustment";

/** Fila de la lista de movimientos, con lo necesario para mostrarla y filtrarla en memoria. */
export interface MovementRow {
  readonly id: string;
  readonly occurredAt: Date;
  readonly title: string;
  readonly merchant: string | null;
  readonly notes: string | null;
  readonly kind: ListKind;
  /** Con signo: negativo si salió plata (gasto), positivo si entró. Transferencias en positivo. */
  readonly amount: Money;
  readonly accountIds: readonly string[];
  readonly accountNames: readonly string[];
  readonly categoryIds: readonly string[];
  readonly categoryNames: readonly string[];
  readonly tags: readonly string[];
  readonly hasReceipt: boolean;
  /** Valor absoluto de cada asiento, para buscar por monto (incluye comisiones). */
  readonly entryAmounts: readonly bigint[];
  /** Texto normalizado guardado con la transacción. */
  readonly searchText: string;
}

/**
 * Especificación que también sabe traducirse a SQL: la base filtra rápido y `isSatisfiedBy`
 * permite probar que ambas dicen lo mismo. `t` es el alias de `transactions`.
 */
export interface SqlSpecification extends Specification<MovementRow> {
  readonly where: string;
  readonly args: readonly SqlValue[];
}

const sqlSpec = (
  where: string,
  args: readonly SqlValue[],
  test: (row: MovementRow) => boolean,
): SqlSpecification => ({ where, args, isSatisfiedBy: test });

const ACCOUNTS = `(SELECT count(DISTINCT e.account_id) FROM entries e
  WHERE e.transaction_id = t.id AND e.account_id IS NOT NULL)`;
const hasCategoryKind = (kind: string) => `EXISTS (SELECT 1 FROM entries e
  JOIN categories c ON c.id = e.category_id WHERE e.transaction_id = t.id AND c.kind = '${kind}')`;

/** Mismo criterio que usa la lista para clasificar cada transacción. */
export const KIND_SQL: Record<ListKind, string> = {
  transfer: `${ACCOUNTS} >= 2`,
  expense: `${ACCOUNTS} < 2 AND ${hasCategoryKind("expense")}`,
  income: `${ACCOUNTS} < 2 AND ${hasCategoryKind("income")}`,
  adjustment: `${ACCOUNTS} < 2 AND NOT ${hasCategoryKind("expense")} AND NOT ${hasCategoryKind("income")}`,
};

export const byKind = (kind: ListKind) => sqlSpec(KIND_SQL[kind], [], (r) => r.kind === kind);

export const byAccount = (id: string) =>
  sqlSpec(
    "EXISTS (SELECT 1 FROM entries e WHERE e.transaction_id = t.id AND e.account_id = ?)",
    [id],
    (r) => r.accountIds.includes(id),
  );

export const byCategory = (id: string) =>
  sqlSpec(
    "EXISTS (SELECT 1 FROM entries e WHERE e.transaction_id = t.id AND e.category_id = ?)",
    [id],
    (r) => r.categoryIds.includes(id),
  );

export const byTag = (name: string) =>
  sqlSpec(
    `EXISTS (SELECT 1 FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id
      WHERE tt.transaction_id = t.id AND g.name = ?)`,
    [name],
    (r) => r.tags.some((tag) => tag.toLocaleLowerCase("es") === name.toLocaleLowerCase("es")),
  );

/** Desde (incluido) hasta (excluido). */
export const byDateRange = (from: Date | null, to: Date | null) =>
  sqlSpec(
    [from ? "t.occurred_at >= ?" : "1", to ? "t.occurred_at < ?" : "1"].join(" AND "),
    [...(from ? [from.toISOString()] : []), ...(to ? [to.toISOString()] : [])],
    (r) => (!from || r.occurredAt >= from) && (!to || r.occurredAt < to),
  );

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** "45.000", "45000" o "12,50": monto en unidades menores; `null` si no parece un monto. */
export function amountQuery(text: string): bigint | null {
  const clean = text.trim().replace(/\$/g, "").replace(/\./g, "").replace(/\s/g, "");
  const m = /^(\d{1,13})(?:,(\d{1,2}))?$/.exec(clean);
  if (!m?.[1]) return null;
  return BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
}

/**
 * Búsqueda libre: comercio, descripción, nota o categoría contienen el texto; o, si el texto es
 * un monto, algún asiento es exactamente ese monto (gasto o ingreso).
 */
export function byText(text: string): SqlSpecification {
  const key = merchantKey(text);
  const like = `%${escapeLike(key)}%`;
  const raw = `%${escapeLike(text.trim())}%`;
  const amount = amountQuery(text);
  // Solo signos ("%", "_"): no hay letras ni números que buscar.
  if (key === "" && amount === null) return sqlSpec("0", [], () => false);
  const textWhere = `(t.search_text LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM entries e
      JOIN categories c ON c.id = e.category_id WHERE e.transaction_id = t.id
      AND (c.name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')))`;
  const amountWhere = `EXISTS (SELECT 1 FROM entries e WHERE e.transaction_id = t.id
    AND abs(e.amount_minor) = ?)`;
  const textMatch = (r: MovementRow) =>
    r.searchText.includes(key) || r.categoryNames.some((c) => merchantKey(c).includes(key));
  if (amount === null) return sqlSpec(textWhere, [like, like, raw], textMatch);
  return sqlSpec(
    `(${textWhere} OR ${amountWhere})`,
    [like, like, raw, Number(amount)],
    (r) => textMatch(r) || r.entryAmounts.includes(amount),
  );
}

/** Une varias especificaciones con AND, en SQL y en memoria. */
export function allSql(...specs: readonly SqlSpecification[]): SqlSpecification {
  const domain = allOf(...specs);
  return {
    where: specs.length === 0 ? "1" : specs.map((s) => `(${s.where})`).join(" AND "),
    args: specs.flatMap((s) => s.args),
    isSatisfiedBy: (r) => domain.isSatisfiedBy(r),
  };
}

/** Filtros que la pantalla puede combinar. Todos opcionales. */
export interface MovementFilters {
  readonly text?: string;
  readonly kind?: ListKind | null;
  readonly accountId?: string | null;
  readonly categoryId?: string | null;
  readonly tag?: string | null;
  readonly from?: Date | null;
  readonly to?: Date | null;
}

export function filtersToSpec(f: MovementFilters): SqlSpecification {
  const specs: SqlSpecification[] = [];
  if (f.text?.trim()) specs.push(byText(f.text));
  if (f.kind) specs.push(byKind(f.kind));
  if (f.accountId) specs.push(byAccount(f.accountId));
  if (f.categoryId) specs.push(byCategory(f.categoryId));
  if (f.tag) specs.push(byTag(f.tag));
  if (f.from || f.to) specs.push(byDateRange(f.from ?? null, f.to ?? null));
  return allSql(...specs);
}
