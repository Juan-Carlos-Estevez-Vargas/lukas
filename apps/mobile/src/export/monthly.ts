import { type CurrencyCode, Money, type RateTable } from "@lukas/domain";
import { fromDbAmount } from "../data/ledger-sqlite";
import type { SqlConnection } from "../data/sql";
import { KIND_SQL, type ListKind } from "../movements/filters";
import { type CategoryAmount, categoryTotals } from "../reports/advanced";
import { cashFlow, type Month, monthRange } from "../reports/reports";

export interface ReportMovement {
  readonly occurredAt: Date;
  readonly kind: ListKind;
  readonly category: string;
  readonly merchant: string;
  readonly notes: string;
  /** Con signo, en la moneda de la cuenta: lo que entró (+) o salió (−) de ella. */
  readonly amount: Money;
}

export interface ReportAccount {
  readonly id: string;
  readonly name: string;
  readonly currency: CurrencyCode;
  readonly opening: Money;
  readonly closing: Money;
  readonly movements: readonly ReportMovement[];
}

export interface MonthlyReport {
  readonly month: Month;
  readonly currency: CurrencyCode;
  readonly income: Money;
  readonly expenses: Money;
  readonly expenseCategories: readonly CategoryAmount[];
  readonly incomeCategories: readonly CategoryAmount[];
  readonly accounts: readonly ReportAccount[];
}

interface Row {
  account_id: string;
  occurred_at: string;
  kind: ListKind;
  categories: string | null;
  merchant: string | null;
  notes: string | null;
  amount_minor: number;
}

/**
 * Todo lo del mes para el reporte: totales e ingresos/gastos por categoría en `currency`, y por
 * cada cuenta (las archivadas solo si se movieron) saldo inicial, final y movimientos.
 */
export async function monthlyReport(
  db: SqlConnection,
  month: Month,
  currency: CurrencyCode,
  rates: RateTable = new Map(),
): Promise<MonthlyReport> {
  const { from, to } = monthRange(month);
  const [flow] = await cashFlow(db, [month], currency, rates);
  const kindCase = (Object.keys(KIND_SQL) as ListKind[])
    .map((k) => `WHEN ${KIND_SQL[k]} THEN '${k}'`)
    .join(" ");
  const rows = await db.all<Row>(
    `SELECT e.account_id, t.occurred_at, CASE ${kindCase} END AS kind, t.merchant, t.notes,
       e.amount_minor,
       (SELECT group_concat(c.name, ' + ') FROM entries ce JOIN categories c ON c.id = ce.category_id
         WHERE ce.transaction_id = t.id AND c.is_system = 0) AS categories
     FROM transactions t
     JOIN entries e ON e.transaction_id = t.id AND e.account_id IS NOT NULL
     WHERE t.deleted_at IS NULL AND t.occurred_at >= ? AND t.occurred_at < ?
     ORDER BY t.occurred_at, t.id`,
    from.toISOString(),
    to.toISOString(),
  );
  const accounts = await db.all<{
    id: string;
    name: string;
    currency: string;
    archived_at: string | null;
    before: number;
    until: number;
  }>(
    `SELECT a.id, a.name, a.currency, a.archived_at,
       coalesce(sum(CASE WHEN t.occurred_at < ? THEN e.amount_minor END), 0) AS before,
       coalesce(sum(CASE WHEN t.occurred_at < ? THEN e.amount_minor END), 0) AS until
     FROM accounts a
     LEFT JOIN entries e ON e.account_id = a.id AND e.currency = a.currency
     LEFT JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL
     GROUP BY a.id
     ORDER BY a.name`,
    from.toISOString(),
    to.toISOString(),
  );
  const byAccount = new Map<string, ReportMovement[]>();
  for (const r of rows) {
    const list = byAccount.get(r.account_id) ?? [];
    const account = accounts.find((a) => a.id === r.account_id);
    list.push({
      occurredAt: new Date(r.occurred_at),
      kind: r.kind,
      category: r.categories ?? "",
      merchant: r.merchant ?? "",
      notes: r.notes ?? "",
      amount: fromDbAmount(r.amount_minor, account?.currency ?? currency),
    });
    byAccount.set(r.account_id, list);
  }
  return {
    month,
    currency,
    income: flow?.income ?? Money.zero(currency),
    expenses: flow?.expenses ?? Money.zero(currency),
    expenseCategories: await categoryTotals(db, month, "expense", currency, rates),
    incomeCategories: await categoryTotals(db, month, "income", currency, rates),
    accounts: accounts
      .filter((a) => !a.archived_at || byAccount.has(a.id))
      .map((a) => ({
        id: a.id,
        name: a.name,
        currency: fromDbAmount(0, a.currency).currencyCode,
        opening: fromDbAmount(a.before, a.currency),
        closing: fromDbAmount(a.until, a.currency),
        movements: byAccount.get(a.id) ?? [],
      })),
  };
}
