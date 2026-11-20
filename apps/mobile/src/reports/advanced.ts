import { daysInMonth } from "@lukas/charts";
import { type CurrencyCode, Money, type RateTable, sumInBase } from "@lukas/domain";
import { fromDbAmount } from "../data/ledger-sqlite";
import type { SqlConnection } from "../data/sql";
import { addMonths, type Month, monthRange } from "./reports";

export interface CategoryAmount {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly amount: Money;
}

const bySize = (a: CategoryAmount, b: CategoryAmount) =>
  a.amount.amountMinor === b.amount.amountMinor
    ? a.name.localeCompare(b.name)
    : a.amount.amountMinor > b.amount.amountMinor
      ? -1
      : 1;

/**
 * Total del mes por categoría principal (las subcategorías suman a su principal), en positivo y de
 * mayor a menor. El ingreso entra a su categoría en negativo, por eso se le cambia el signo.
 */
export async function categoryTotals(
  db: SqlConnection,
  month: Month,
  kind: "income" | "expense",
  currency: CurrencyCode,
  rates: RateTable = new Map(),
): Promise<CategoryAmount[]> {
  const { from, to } = monthRange(month);
  const rows = await db.all<{
    id: string;
    name: string;
    icon: string | null;
    currency: string;
    total: number;
  }>(
    `SELECT root.id AS id, root.name AS name, root.icon AS icon, e.currency AS currency,
       sum(e.amount_minor) AS total
     FROM entries e
     JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL
     JOIN categories c ON c.id = e.category_id
     JOIN categories root ON root.id = coalesce(c.parent_id, c.id)
     WHERE c.kind = ? AND t.occurred_at >= ? AND t.occurred_at < ?
     GROUP BY root.id, e.currency`,
    kind,
    from.toISOString(),
    to.toISOString(),
  );
  const sign = kind === "income" ? -1 : 1;
  const byRoot = new Map<string, { name: string; icon: string | null; amounts: Money[] }>();
  for (const r of rows) {
    const item = byRoot.get(r.id) ?? { name: r.name, icon: r.icon, amounts: [] };
    item.amounts.push(fromDbAmount(sign * r.total, r.currency));
    byRoot.set(r.id, item);
  }
  return [...byRoot.entries()]
    .map(([id, item]) => ({
      id,
      name: item.name,
      icon: item.icon,
      amount: sumInBase(item.amounts, currency, rates).total,
    }))
    .filter((c) => c.amount.amountMinor > 0n)
    .sort(bySize);
}

export interface MoneyFlow {
  readonly income: readonly CategoryAmount[];
  readonly expenses: readonly CategoryAmount[];
  /** Lo que sobró del ingreso (cero si se gastó más). */
  readonly savings: Money;
  /** Lo gastado de más sobre el ingreso del mes (cero si alcanzó). */
  readonly deficit: Money;
}

const total = (list: readonly CategoryAmount[], currency: CurrencyCode) =>
  list.reduce((s, c) => s.add(c.amount), Money.zero(currency));

/** De dónde entró la plata del mes y a dónde se fue: los datos del Sankey, ya equilibrados. */
export async function moneyFlow(
  db: SqlConnection,
  month: Month,
  currency: CurrencyCode,
  rates: RateTable = new Map(),
): Promise<MoneyFlow> {
  const [income, expenses] = await Promise.all([
    categoryTotals(db, month, "income", currency, rates),
    categoryTotals(db, month, "expense", currency, rates),
  ]);
  const left = total(income, currency).subtract(total(expenses, currency));
  const zero = Money.zero(currency);
  return {
    income,
    expenses,
    savings: left.amountMinor > 0n ? left : zero,
    deficit: left.amountMinor < 0n ? left.negate() : zero,
  };
}

/**
 * Gasto de cada día del mes (posición 0 = día 1), en unidades menores de `currency`. El día es el
 * de la hora del teléfono, igual que en Movimientos.
 */
export async function dailySpending(
  db: SqlConnection,
  month: Month,
  currency: CurrencyCode,
  rates: RateTable = new Map(),
): Promise<bigint[]> {
  const { from, to } = monthRange(month);
  const rows = await db.all<{ occurred_at: string; currency: string; amount: number }>(
    `SELECT t.occurred_at AS occurred_at, e.currency AS currency, e.amount_minor AS amount
     FROM entries e
     JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL
     JOIN categories c ON c.id = e.category_id
     WHERE c.kind = 'expense' AND t.occurred_at >= ? AND t.occurred_at < ?`,
    from.toISOString(),
    to.toISOString(),
  );
  const perDay: Money[][] = Array.from({ length: daysInMonth(month.year, month.month) }, () => []);
  for (const r of rows)
    perDay[new Date(r.occurred_at).getDate() - 1]?.push(fromDbAmount(r.amount, r.currency));
  return perDay.map((amounts) => sumInBase(amounts, currency, rates).total.amountMinor);
}

/** Contra qué mes se compara: el anterior o el mismo del año pasado. */
export type CompareBase = "previous" | "lastYear";

export const baseMonth = (m: Month, base: CompareBase): Month =>
  addMonths(m, base === "previous" ? -1 : -12);

export interface CategoryChange {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly current: Money;
  readonly before: Money;
  /** `current − before`: positivo es que se gastó más. */
  readonly change: Money;
}

export interface MonthComparison {
  readonly current: Month;
  readonly before: Month;
  readonly totalCurrent: Money;
  readonly totalBefore: Money;
  /** Las categorías con gasto en alguno de los dos meses, de mayor a menor cambio (en valor absoluto). */
  readonly categories: readonly CategoryChange[];
}

const abs = (v: bigint) => (v < 0n ? -v : v);

/** Gasto de `current` contra `before`, por categoría principal. */
export async function compareMonths(
  db: SqlConnection,
  current: Month,
  before: Month,
  currency: CurrencyCode,
  rates: RateTable = new Map(),
): Promise<MonthComparison> {
  const [now, then] = await Promise.all([
    categoryTotals(db, current, "expense", currency, rates),
    categoryTotals(db, before, "expense", currency, rates),
  ]);
  const zero = Money.zero(currency);
  const ids = new Map<string, { name: string; icon: string | null }>();
  for (const c of [...now, ...then]) ids.set(c.id, { name: c.name, icon: c.icon });
  const amountIn = (list: readonly CategoryAmount[], id: string) =>
    list.find((c) => c.id === id)?.amount ?? zero;
  const categories = [...ids.entries()]
    .map(([id, meta]): CategoryChange => {
      const a = amountIn(now, id);
      const b = amountIn(then, id);
      return { id, ...meta, current: a, before: b, change: a.subtract(b) };
    })
    .sort((x, y) => {
      const dx = abs(x.change.amountMinor);
      const dy = abs(y.change.amountMinor);
      return dx === dy ? x.name.localeCompare(y.name) : dx > dy ? -1 : 1;
    });
  return {
    current,
    before,
    totalCurrent: total(now, currency),
    totalBefore: total(then, currency),
    categories,
  };
}
