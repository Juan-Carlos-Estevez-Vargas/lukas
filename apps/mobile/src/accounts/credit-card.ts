import {
  type Account,
  billingDaysOf,
  type CardSummary,
  type CivilDate,
  currentCycle,
  type DomainError,
  lastClosedCycle,
  nextDay,
  type Result,
  summarizeCard,
} from "@lukas/domain";
import { fromDbAmount, sqliteAccounts } from "../data/ledger-sqlite";
import type { SqlConnection } from "../data/sql";

/** Fecha de calendario del teléfono (su zona horaria), que es la que usa el banco. */
export const civilDate = (d: Date): CivilDate => ({
  year: d.getFullYear(),
  month: d.getMonth() + 1,
  day: d.getDate(),
});

/** Primer instante del día en la zona del teléfono, en el formato en que se guarda `occurred_at`. */
export const startOfDay = (c: CivilDate): string =>
  new Date(c.year, c.month - 1, c.day).toISOString();

const SUM = `SELECT coalesce(sum(e.amount_minor), 0) AS total
  FROM entries e JOIN transactions t ON t.id = e.transaction_id
  WHERE e.account_id = ? AND e.currency = ? AND t.deleted_at IS NULL`;

async function sum(db: SqlConnection, account: Account, where: string, ...args: string[]) {
  const row = await db.get<{ total: number }>(
    `${SUM} ${where}`,
    account.id,
    account.currency,
    ...args,
  );
  return fromDbAmount(row?.total ?? 0, account.currency);
}

/** Resumen de una tarjeta: deuda, saldo del extracto, pago mínimo estimado y cupo disponible. */
export async function cardSummary(
  db: SqlConnection,
  account: Account,
  today: CivilDate,
): Promise<Result<CardSummary, DomainError>> {
  const days = billingDaysOf(account);
  if (!days.ok) return days;
  const afterClosing = startOfDay(nextDay(lastClosedCycle(days.value, today).closes));
  const cycle = currentCycle(days.value, today);
  const [balance, balanceAtLastClosing, paidSinceClosing, chargesThisCycle] = await Promise.all([
    sqliteAccounts(db).balance(account),
    sum(db, account, "AND t.occurred_at < ?", afterClosing),
    sum(db, account, "AND t.occurred_at >= ? AND e.amount_minor > 0", afterClosing),
    sum(
      db,
      account,
      "AND t.occurred_at >= ? AND t.occurred_at < ? AND e.amount_minor < 0",
      startOfDay(cycle.opens),
      startOfDay(nextDay(cycle.closes)),
    ),
  ]);
  return {
    ok: true,
    value: summarizeCard(account, days.value, today, {
      balance,
      balanceAtLastClosing,
      paidSinceClosing,
      chargesThisCycle: chargesThisCycle.negate(),
    }),
  };
}

/** Lee un día del mes escrito por la persona: vacío es `null`, fuera de 1–31 es `undefined`. */
export function parseDay(text: string): number | null | undefined {
  const clean = text.trim();
  if (clean === "") return null;
  if (!/^\d{1,2}$/.test(clean)) return undefined;
  const n = Number(clean);
  return n >= 1 && n <= 31 ? n : undefined;
}
