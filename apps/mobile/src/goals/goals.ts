import {
  type CivilDate,
  DomainError,
  type GoalProgress,
  goalProgress,
  type Money,
  type Result,
  validateGoal,
} from "@lukas/domain";
import type { Clock } from "../accounts/accounts";
import { fromDbAmount, sqliteAccounts, toDbAmount } from "../data/ledger-sqlite";
import type { SqlConnection } from "../data/sql";
import { civilKey, parseCivil } from "../recurring/recurring";

export interface Goal {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly target: Money;
  readonly targetDate: CivilDate;
  /** Cuenta donde se ahorra; su saldo es lo ahorrado. `null`: abonos anotados a mano. */
  readonly accountId: string | null;
}

export interface GoalInput {
  readonly name: string;
  readonly icon?: string | null;
  readonly target: Money;
  readonly targetDate: CivilDate;
  readonly accountId: string | null;
}

export interface GoalView {
  readonly goal: Goal;
  readonly progress: GoalProgress;
}

interface Row {
  id: string;
  name: string;
  icon: string | null;
  target_minor: number;
  currency: string;
  target_date: string;
  account_id: string | null;
  saved_minor: number;
}

const fromRow = (r: Row): Goal => {
  const targetDate = parseCivil(r.target_date);
  if (!targetDate) throw new Error(`Fecha guardada inválida: ${r.target_date}`);
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    target: fromDbAmount(r.target_minor, r.currency),
    targetDate,
    accountId: r.account_id,
  };
};

const fail = (code: string, message: string): Result<never, DomainError> => ({
  ok: false,
  error: new DomainError(code, message),
});

export async function createGoal(
  db: SqlConnection,
  input: GoalInput,
  today: CivilDate,
  clock: Clock,
): Promise<Result<Goal, DomainError>> {
  const name = validateGoal({ ...input, today });
  if (!name.ok) return name;
  if (input.accountId !== null) {
    const account = await sqliteAccounts(db).get(input.accountId);
    if (!account || account.archivedAt) return fail("account_not_found", "No existe la cuenta");
    if (account.currency !== input.target.currencyCode) {
      return fail("currency_mismatch", "La meta debe estar en la moneda de la cuenta");
    }
  }
  const id = clock.newId();
  const now = clock.now().toISOString();
  const icon = input.icon?.trim() || null;
  await db.run(
    `INSERT INTO goals (id, name, icon, target_minor, currency, target_date, account_id,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    name.value,
    icon,
    toDbAmount(input.target),
    input.target.currencyCode,
    civilKey(input.targetDate),
    input.accountId,
    now,
    now,
  );
  return {
    ok: true,
    value: {
      id,
      name: name.value,
      icon,
      target: input.target,
      targetDate: input.targetDate,
      accountId: input.accountId,
    },
  };
}

async function savedOf(db: SqlConnection, row: Row): Promise<Money> {
  if (row.account_id) {
    const account = await sqliteAccounts(db).get(row.account_id);
    if (account) return sqliteAccounts(db).balance(account);
  }
  return fromDbAmount(row.saved_minor, row.currency);
}

async function viewOf(db: SqlConnection, row: Row, today: CivilDate): Promise<GoalView> {
  const goal = fromRow(row);
  const saved = await savedOf(db, row);
  return { goal, progress: goalProgress(goal.target, saved, today, goal.targetDate) };
}

/** Metas activas con su avance; primero las de fecha más cercana. */
export async function goalViews(db: SqlConnection, today: CivilDate): Promise<GoalView[]> {
  const rows = await db.all<Row>(
    "SELECT * FROM goals WHERE archived_at IS NULL ORDER BY target_date, name COLLATE NOCASE",
  );
  const views: GoalView[] = [];
  for (const row of rows) views.push(await viewOf(db, row, today));
  return views;
}

export async function goalView(
  db: SqlConnection,
  id: string,
  today: CivilDate,
): Promise<GoalView | null> {
  const row = await db.get<Row>("SELECT * FROM goals WHERE id = ?", id);
  return row ? viewOf(db, row, today) : null;
}

/**
 * Anota un abono (o un retiro, si es negativo) en una meta sin cuenta. Lo ahorrado nunca baja de
 * cero. En metas con cuenta, el avance sale del saldo: se abona con una transferencia.
 */
export async function contributeToGoal(
  db: SqlConnection,
  id: string,
  amount: Money,
  clock: Clock,
): Promise<Result<true, DomainError>> {
  const row = await db.get<Row>("SELECT * FROM goals WHERE id = ?", id);
  if (!row) return fail("not_found", "No existe la meta");
  if (row.account_id) return fail("goal_has_account", "Abona con una transferencia a la cuenta");
  if (amount.isZero() || amount.currencyCode !== row.currency) {
    return fail("invalid_amount", "Monto inválido");
  }
  await db.run(
    "UPDATE goals SET saved_minor = max(0, saved_minor + ?), updated_at = ? WHERE id = ?",
    toDbAmount(amount),
    clock.now().toISOString(),
    id,
  );
  return { ok: true, value: true };
}

export async function archiveGoal(db: SqlConnection, id: string, clock: Clock): Promise<void> {
  const now = clock.now().toISOString();
  await db.run("UPDATE goals SET archived_at = ?, updated_at = ? WHERE id = ?", now, now, id);
}
