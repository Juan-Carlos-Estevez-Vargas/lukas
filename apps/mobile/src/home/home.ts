import {
  addDays,
  type CivilDate,
  type CurrencyCode,
  compareCivil,
  daysBetween,
  divideRounded,
  Money,
  periodWindow,
  type RateTable,
  sumInBase,
} from "@lukas/domain";
import { cardSummary } from "../accounts/credit-card";
import { budgetView, listBudgets } from "../budgets/budgets";
import { fromDbAmount, sqliteAccounts } from "../data/ledger-sqlite";
import type { SqlConnection } from "../data/sql";
import { listRecurring, pendingOf, upcomingOf } from "../recurring/recurring";

const startOf = (d: CivilDate): string => new Date(d.year, d.month - 1, d.day).toISOString();

export interface MonthAvailable {
  readonly income: Money;
  readonly expenses: Money;
  /** Lo que queda para gastar este mes (puede ser negativo). */
  readonly available: Money;
  /** De dónde sale: el presupuesto general del mes o ingresos menos gastos. */
  readonly source: "budget" | "cashflow";
  /** Días que quedan del mes, contando hoy. */
  readonly daysLeft: number;
  /** Cuánto se puede gastar por día sin pasarse, en pesos enteros hacia abajo; cero si no queda. */
  readonly perDay: Money;
}

/** Gastos e ingresos netos del mes por moneda, convertidos a `currency` con las tasas dadas. */
async function monthFlows(
  db: SqlConnection,
  today: CivilDate,
  currency: CurrencyCode,
  rates: RateTable,
): Promise<{ income: Money; expenses: Money }> {
  const window = periodWindow("monthly", today);
  const rows = await db.all<{ kind: string; currency: string; total: number }>(
    `SELECT c.kind AS kind, e.currency AS currency, sum(e.amount_minor) AS total
     FROM entries e
     JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL
     JOIN categories c ON c.id = e.category_id
     WHERE c.kind IN ('income', 'expense') AND t.occurred_at >= ? AND t.occurred_at < ?
     GROUP BY c.kind, e.currency`,
    startOf(window.start),
    startOf(addDays(window.end, 1)),
  );
  const total = (kind: string, sign: number) =>
    sumInBase(
      rows.filter((r) => r.kind === kind).map((r) => fromDbAmount(sign * r.total, r.currency)),
      currency,
      rates,
    ).total;
  // El ingreso entra a su categoría en negativo.
  return { income: total("income", -1), expenses: total("expense", 1) };
}

export async function monthAvailable(
  db: SqlConnection,
  today: CivilDate,
  currency: CurrencyCode,
  rates: RateTable = new Map(),
): Promise<MonthAvailable> {
  const window = periodWindow("monthly", today);
  const { income, expenses } = await monthFlows(db, today, currency, rates);
  const general = (await listBudgets(db)).find(
    (b) => b.categoryId === null && b.period === "monthly" && b.amount.currencyCode === currency,
  );
  const available = general
    ? (await budgetView(db, general, today)).status.remaining
    : income.subtract(expenses);
  const daysLeft = daysBetween(today, window.end) + 1;
  const perDay = available.isNegative()
    ? Money.zero(currency)
    : Money.ofMinor(
        divideRounded(available.amountMinor / BigInt(daysLeft), 100n, "floor") * 100n,
        currency,
      );
  return {
    income,
    expenses,
    available,
    source: general ? "budget" : "cashflow",
    daysLeft,
    perDay,
  };
}

export interface CategorySpend {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly spent: Money;
}

/** Categorías con más gasto del mes; las subcategorías suman a su categoría principal. */
export async function topCategories(
  db: SqlConnection,
  today: CivilDate,
  currency: CurrencyCode,
  limit = 3,
  rates: RateTable = new Map(),
): Promise<CategorySpend[]> {
  const window = periodWindow("monthly", today);
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
     WHERE c.kind = 'expense' AND t.occurred_at >= ? AND t.occurred_at < ?
     GROUP BY root.id, e.currency`,
    startOf(window.start),
    startOf(addDays(window.end, 1)),
  );
  const byRoot = new Map<string, { name: string; icon: string | null; amounts: Money[] }>();
  for (const r of rows) {
    const item = byRoot.get(r.id) ?? { name: r.name, icon: r.icon, amounts: [] };
    item.amounts.push(fromDbAmount(r.total, r.currency));
    byRoot.set(r.id, item);
  }
  return [...byRoot.entries()]
    .map(([id, item]) => ({
      id,
      name: item.name,
      icon: item.icon,
      spent: sumInBase(item.amounts, currency, rates).total,
    }))
    .filter((c) => c.spent.amountMinor > 0n)
    .sort((a, b) =>
      a.spent.amountMinor === b.spent.amountMinor
        ? a.name.localeCompare(b.name)
        : a.spent.amountMinor > b.spent.amountMinor
          ? -1
          : 1,
    )
    .slice(0, limit);
}

export interface UpcomingPayment {
  readonly kind: "recurring" | "card";
  /** Id del recurrente o de la tarjeta. */
  readonly id: string;
  readonly name: string;
  readonly date: CivilDate;
  readonly amount: Money;
  /** Ya pasó la fecha y sigue pendiente. */
  readonly overdue: boolean;
}

/**
 * Lo que hay que pagar en los próximos días: gastos recurrentes (incluidos los vencidos que
 * esperan confirmación) y el pago de las tarjetas con saldo. Primero lo más próximo.
 */
export async function upcomingPayments(
  db: SqlConnection,
  today: CivilDate,
  horizonDays = 30,
  limit = 3,
): Promise<UpcomingPayment[]> {
  const horizon = addDays(today, horizonDays);
  const out: UpcomingPayment[] = [];
  for (const r of await listRecurring(db)) {
    if (r.kind !== "expense") continue;
    const overdue = r.autoPost ? undefined : pendingOf(r, addDays(today, -1))[0];
    const next = overdue ?? upcomingOf(r, today);
    if (!next || compareCivil(next, horizon) > 0) continue;
    out.push({
      kind: "recurring",
      id: r.id,
      name: r.name,
      date: next,
      amount: r.amount,
      overdue: compareCivil(next, today) < 0,
    });
  }
  const cards = (await sqliteAccounts(db).list()).filter((a) => a.type === "credit_card");
  for (const card of cards) {
    const res = await cardSummary(db, card, today);
    if (!res.ok) continue;
    const s = res.value;
    const pending = !s.amountDue.isZero();
    const date = pending ? s.lastStatement.due : s.chargesThisCycle.isZero() ? null : s.cycle.due;
    if (!date || compareCivil(date, horizon) > 0) continue;
    out.push({
      kind: "card",
      id: card.id,
      name: card.name,
      date,
      amount: pending ? s.amountDue : s.chargesThisCycle,
      overdue: compareCivil(date, today) < 0,
    });
  }
  return out
    .sort((a, b) => compareCivil(a.date, b.date) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export interface NetWorth {
  readonly total: Money;
  /** Monedas de cuentas que no se pudieron sumar por falta de tasa. */
  readonly missing: readonly string[];
}

/** Patrimonio en `currency`: suma los saldos de las cuentas activas, convertidos con las tasas. */
export function netWorthOf(
  balances: readonly { readonly balance: Money; readonly archived: boolean }[],
  currency: CurrencyCode,
  rates: RateTable,
): NetWorth {
  return sumInBase(
    balances.filter((b) => !b.archived).map((b) => b.balance),
    currency,
    rates,
  );
}
