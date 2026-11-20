import { type CurrencyCode, type Money, type RateTable, sumInBase } from "@lukas/domain";
import { fromDbAmount } from "../data/ledger-sqlite";
import type { SqlConnection } from "../data/sql";
import { type CategorySpend, topCategories } from "../home/home";

/** Un mes del calendario (1 a 12). */
export interface Month {
  readonly year: number;
  readonly month: number;
}

export const monthKey = (m: Month): string => `${m.year}-${String(m.month).padStart(2, "0")}`;

/** "2026-10" → mes; `null` si no tiene esa forma. Sirve para los enlaces desde un gráfico. */
export function parseMonth(value: string | undefined): Month | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : null;
}

/** El mes `by` meses después (o antes, si es negativo). */
export const addMonths = (m: Month, by: number): Month => {
  const index = m.year * 12 + (m.month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

/** Los últimos `count` meses hasta `last` incluido, del más viejo al más nuevo. */
export const lastMonths = (last: Month, count: number): Month[] =>
  Array.from({ length: count }, (_, i) => addMonths(last, i - count + 1));

/** Rango [desde, hasta) del mes en la hora del teléfono, como lo guarda la base. */
export function monthRange(m: Month): { from: Date; to: Date } {
  return { from: new Date(m.year, m.month - 1, 1), to: new Date(m.year, m.month, 1) };
}

export interface MonthFlow {
  readonly month: Month;
  readonly income: Money;
  readonly expenses: Money;
}

/** Ingresos y gastos de cada mes, convertidos a `currency`. Transferencias y ajustes no cuentan. */
export async function cashFlow(
  db: SqlConnection,
  months: readonly Month[],
  currency: CurrencyCode,
  rates: RateTable = new Map(),
): Promise<MonthFlow[]> {
  const out: MonthFlow[] = [];
  for (const month of months) {
    const { from, to } = monthRange(month);
    const rows = await db.all<{ kind: string; currency: string; total: number }>(
      `SELECT c.kind AS kind, e.currency AS currency, sum(e.amount_minor) AS total
       FROM entries e
       JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL
       JOIN categories c ON c.id = e.category_id
       WHERE c.kind IN ('income', 'expense') AND t.occurred_at >= ? AND t.occurred_at < ?
       GROUP BY c.kind, e.currency`,
      from.toISOString(),
      to.toISOString(),
    );
    const total = (kind: string, sign: number) =>
      sumInBase(
        rows.filter((r) => r.kind === kind).map((r) => fromDbAmount(sign * r.total, r.currency)),
        currency,
        rates,
      ).total;
    // El ingreso entra a su categoría en negativo.
    out.push({ month, income: total("income", -1), expenses: total("expense", 1) });
  }
  return out;
}

/** Gasto del mes por categoría principal, de mayor a menor. */
export const spendingByCategory = (
  db: SqlConnection,
  month: Month,
  currency: CurrencyCode,
  rates: RateTable = new Map(),
): Promise<CategorySpend[]> =>
  topCategories(db, { ...month, day: 1 }, currency, Number.POSITIVE_INFINITY, rates);

export interface MonthNetWorth {
  readonly month: Month;
  readonly total: Money;
}

/**
 * Patrimonio al cierre de cada mes: saldo de las cuentas activas con lo registrado hasta ese día.
 * Usa la tasa de hoy para todos los meses (no se guarda la historia de la TRM).
 */
export async function netWorthSeries(
  db: SqlConnection,
  months: readonly Month[],
  currency: CurrencyCode,
  rates: RateTable = new Map(),
): Promise<MonthNetWorth[]> {
  const out: MonthNetWorth[] = [];
  for (const month of months) {
    const rows = await db.all<{ currency: string; total: number }>(
      `SELECT e.currency AS currency, sum(e.amount_minor) AS total
       FROM entries e
       JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL
       JOIN accounts a ON a.id = e.account_id AND a.archived_at IS NULL
       WHERE t.occurred_at < ?
       GROUP BY e.currency`,
      monthRange(month).to.toISOString(),
    );
    const total = sumInBase(
      rows.map((r) => fromDbAmount(r.total, r.currency)),
      currency,
      rates,
    ).total;
    out.push({ month, total });
  }
  return out;
}
