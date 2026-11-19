import {
  type AlertLevel,
  addDays,
  BUDGET_GROUPS,
  type BudgetGroup,
  type BudgetPeriod,
  type BudgetStatus,
  budgetStatus,
  type CivilDate,
  type CurrencyCode,
  DomainError,
  type Money,
  type PeriodWindow,
  pendingAlerts,
  periodsBetween,
  periodWindow,
  type Result,
  split503020,
  validateBudgetAmount,
} from "@lukas/domain";
import type { Clock } from "../accounts/accounts";
import { fromDbAmount, toDbAmount } from "../data/ledger-sqlite";
import type { SqlConnection, SqlValue } from "../data/sql";
import { civilKey, parseCivil } from "../recurring/recurring";

export interface Budget {
  readonly id: string;
  /** `null`: todos los gastos. */
  readonly categoryId: string | null;
  readonly period: BudgetPeriod;
  readonly amount: Money;
  /** Sobre: lo que sobra o falta pasa al siguiente periodo. */
  readonly rollover: boolean;
  readonly startsOn: CivilDate;
}

export interface BudgetInput {
  readonly categoryId: string | null;
  readonly period: BudgetPeriod;
  readonly amount: Money;
  readonly rollover: boolean;
}

interface Row {
  id: string;
  category_id: string | null;
  period: BudgetPeriod;
  amount_minor: number;
  currency: string;
  rollover: number;
  starts_on: string;
}

const fromRow = (r: Row): Budget => {
  const startsOn = parseCivil(r.starts_on);
  if (!startsOn) throw new Error(`Fecha guardada inválida: ${r.starts_on}`);
  return {
    id: r.id,
    categoryId: r.category_id,
    period: r.period,
    amount: fromDbAmount(r.amount_minor, r.currency),
    rollover: r.rollover === 1,
    startsOn,
  };
};

const fail = (code: string, message: string): Result<never, DomainError> => ({
  ok: false,
  error: new DomainError(code, message),
});

/** Crea un presupuesto que empieza a contar en el periodo actual. */
export async function createBudget(
  db: SqlConnection,
  input: BudgetInput,
  today: CivilDate,
  clock: Clock,
): Promise<Result<Budget, DomainError>> {
  const amount = validateBudgetAmount(input.amount);
  if (!amount.ok) return amount;
  if (input.categoryId !== null) {
    const category = await db.get<{ kind: string }>(
      "SELECT kind FROM categories WHERE id = ? AND archived_at IS NULL AND is_system = 0",
      input.categoryId,
    );
    if (category?.kind !== "expense") {
      return fail("invalid_category", "Los presupuestos son para categorías de gasto");
    }
  }
  const existing = await db.get(
    `SELECT 1 AS x FROM budgets WHERE coalesce(category_id, '') = ? AND period = ?
       AND archived_at IS NULL`,
    input.categoryId ?? "",
    input.period,
  );
  if (existing) return fail("budget_exists", "Ya hay un presupuesto para eso en ese periodo");
  const startsOn = periodWindow(input.period, today).start;
  const id = clock.newId();
  const now = clock.now().toISOString();
  await db.run(
    `INSERT INTO budgets (id, category_id, period, amount_minor, currency, rollover, starts_on,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.categoryId,
    input.period,
    toDbAmount(input.amount),
    input.amount.currencyCode,
    input.rollover ? 1 : 0,
    civilKey(startsOn),
    now,
    now,
  );
  return { ok: true, value: { id, ...input, startsOn } };
}

export async function updateBudgetAmount(
  db: SqlConnection,
  id: string,
  amount: Money,
  clock: Clock,
): Promise<Result<true, DomainError>> {
  const valid = validateBudgetAmount(amount);
  if (!valid.ok) return valid;
  await db.run(
    "UPDATE budgets SET amount_minor = ?, currency = ?, updated_at = ? WHERE id = ?",
    toDbAmount(amount),
    amount.currencyCode,
    clock.now().toISOString(),
    id,
  );
  return { ok: true, value: true };
}

export async function archiveBudget(db: SqlConnection, id: string, clock: Clock) {
  const now = clock.now().toISOString();
  await db.run("UPDATE budgets SET archived_at = ?, updated_at = ? WHERE id = ?", now, now, id);
}

export async function listBudgets(db: SqlConnection): Promise<Budget[]> {
  return (await db.all<Row>("SELECT * FROM budgets WHERE archived_at IS NULL")).map(fromRow);
}

/** Medianoche local del día, en el ISO UTC con que se guardan los movimientos. */
const startOf = (d: CivilDate): string => new Date(d.year, d.month - 1, d.day).toISOString();

/**
 * Gasto neto de gastos en la ventana: lo que entró a la categoría (y a sus subcategorías) menos
 * los reembolsos. Sin categoría, todos los gastos.
 */
export async function spentIn(
  db: SqlConnection,
  categoryId: string | null,
  window: PeriodWindow,
  currency: CurrencyCode,
): Promise<Money> {
  const params: SqlValue[] = [currency, startOf(window.start), startOf(addDays(window.end, 1))];
  let filter = "c.kind = 'expense'";
  if (categoryId !== null) {
    filter += " AND (c.id = ? OR c.parent_id = ?)";
    params.push(categoryId, categoryId);
  }
  const row = await db.get<{ total: number }>(
    `SELECT coalesce(sum(e.amount_minor), 0) AS total
     FROM entries e
     JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL
     JOIN categories c ON c.id = e.category_id
     WHERE e.currency = ? AND t.occurred_at >= ? AND t.occurred_at < ? AND ${filter}`,
    ...params,
  );
  return fromDbAmount(row?.total ?? 0, currency);
}

export interface BudgetView {
  readonly budget: Budget;
  /** Nombre e ícono de la categoría; `null` si es el presupuesto general. */
  readonly category: { readonly name: string; readonly icon: string | null } | null;
  readonly window: PeriodWindow;
  readonly status: BudgetStatus;
}

export async function budgetView(
  db: SqlConnection,
  budget: Budget,
  today: CivilDate,
): Promise<BudgetView> {
  const currency = budget.amount.currencyCode;
  const window = periodWindow(budget.period, today);
  const spentNow = await spentIn(db, budget.categoryId, window, currency);
  const periodsBefore = budget.rollover ? periodsBetween(budget.period, budget.startsOn, today) : 0;
  const envelope =
    periodsBefore > 0
      ? {
          periodsBefore,
          spentBefore: await spentIn(
            db,
            budget.categoryId,
            { start: budget.startsOn, end: addDays(window.start, -1) },
            currency,
          ),
        }
      : null;
  const category = budget.categoryId
    ? await db.get<{ name: string; icon: string | null }>(
        "SELECT name, icon FROM categories WHERE id = ?",
        budget.categoryId,
      )
    : null;
  return {
    budget,
    category,
    window,
    status: budgetStatus({ limit: budget.amount, spentNow, envelope }),
  };
}

/** Todos los presupuestos activos con su estado; primero los más gastados. */
export async function budgetViews(db: SqlConnection, today: CivilDate): Promise<BudgetView[]> {
  const views: BudgetView[] = [];
  for (const b of await listBudgets(db)) views.push(await budgetView(db, b, today));
  return views.sort((a, b) => b.status.percent - a.status.percent);
}

export interface BudgetAlert {
  readonly view: BudgetView;
  readonly level: AlertLevel;
}

/**
 * Avisos nuevos de este periodo (80 % y 100 %). Los anota para no repetirlos: llamar después de
 * cada registro y al abrir la app es seguro.
 */
export async function checkBudgetAlerts(
  db: SqlConnection,
  today: CivilDate,
  clock: Clock,
): Promise<BudgetAlert[]> {
  const alerts: BudgetAlert[] = [];
  for (const view of await budgetViews(db, today)) {
    const periodStart = civilKey(view.window.start);
    const sent = await db.all<{ level: AlertLevel }>(
      "SELECT level FROM budget_alerts WHERE budget_id = ? AND period_start = ?",
      view.budget.id,
      periodStart,
    );
    const pending = pendingAlerts(
      view.status.level,
      sent.map((s) => s.level),
    );
    const last = pending.at(-1);
    if (!last) continue;
    await db.transaction(async (tx) => {
      for (const level of pending) {
        await tx.run(
          `INSERT OR IGNORE INTO budget_alerts (budget_id, period_start, level, created_at)
           VALUES (?, ?, ?, ?)`,
          view.budget.id,
          periodStart,
          level,
          clock.now().toISOString(),
        );
      }
    });
    alerts.push({ view, level: last });
  }
  return alerts;
}

export async function setBudgetGroup(
  db: SqlConnection,
  categoryId: string,
  group: BudgetGroup | null,
): Promise<void> {
  await db.run("UPDATE categories SET budget_group = ? WHERE id = ?", group, categoryId);
}

export interface FiftyThirtyTwenty {
  readonly income: Money;
  /** Cuánto debería ir a cada grupo según el ingreso del mes. */
  readonly targets: Record<BudgetGroup, Money>;
  /** Lo real: gasto en necesidades y gustos; ahorro = ingreso − gastos + lo que va a ahorro. */
  readonly actual: Record<BudgetGroup, Money>;
  /** Gasto en categorías sin grupo. */
  readonly unassigned: Money;
}

/** Comparación del mes con la regla 50/30/20, en una moneda. */
export async function fiftyThirtyTwenty(
  db: SqlConnection,
  today: CivilDate,
  currency: CurrencyCode,
): Promise<FiftyThirtyTwenty> {
  const window = periodWindow("monthly", today);
  const rows = await db.all<{ kind: string; grp: BudgetGroup | null; total: number }>(
    `SELECT c.kind AS kind, c.budget_group AS grp, sum(e.amount_minor) AS total
     FROM entries e
     JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL
     JOIN categories c ON c.id = e.category_id
     WHERE e.currency = ? AND t.occurred_at >= ? AND t.occurred_at < ?
       AND c.kind IN ('income', 'expense')
     GROUP BY c.kind, c.budget_group`,
    currency,
    startOf(window.start),
    startOf(addDays(window.end, 1)),
  );
  const money = (n: number) => fromDbAmount(n, currency);
  // En el libro el ingreso entra a su categoría en negativo.
  const income = money(-rows.filter((r) => r.kind === "income").reduce((s, r) => s + r.total, 0));
  const expense = rows.filter((r) => r.kind === "expense");
  const of = (g: BudgetGroup | null) =>
    money(expense.filter((r) => r.grp === g).reduce((s, r) => s + r.total, 0));
  const spentTotal = money(expense.reduce((s, r) => s + r.total, 0));
  const actual = Object.fromEntries(
    BUDGET_GROUPS.map((g) => [g, g === "savings" ? income.subtract(spentTotal).add(of(g)) : of(g)]),
  ) as Record<BudgetGroup, Money>;
  return { income, targets: split503020(income), actual, unassigned: of(null) };
}
