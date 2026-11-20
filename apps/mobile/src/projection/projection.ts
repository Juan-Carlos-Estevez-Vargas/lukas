import {
  addDays,
  type CivilDate,
  CURRENCIES,
  type CurrencyCode,
  compareCivil,
  Money,
  occurrencesBetween,
} from "@lukas/domain";
import { civilDate, startOfDay } from "../accounts/credit-card";
import { sqliteAccounts } from "../data/ledger-sqlite";
import type { SqlConnection } from "../data/sql";
import { listRecurring, pendingOf, upcomingOf } from "../recurring/recurring";

/** Días que se proyectan hacia adelante. */
export const PROJECTION_DAYS = 90;
/** Días hacia atrás para sacar el promedio de lo que no es recurrente. */
export const LOOKBACK_DAYS = 90;
/** Mínimo de días para promediar: una cuenta nueva con un gasto grande no se proyecta en picada. */
export const MIN_LOOKBACK_DAYS = 30;

/** Las cuentas donde vive la plata disponible; tarjetas, préstamos e inversiones no se proyectan. */
const LIQUID = new Set(["cash", "bank", "digital_wallet"]);

export interface ScheduledFlow {
  readonly date: CivilDate;
  /** Con signo: negativo es plata que sale. Unidades menores de la moneda de la cuenta. */
  readonly amount: bigint;
  readonly name: string;
}

export interface ProjectionPoint {
  readonly date: CivilDate;
  readonly balance: bigint;
}

/**
 * Saldo de cada día desde `today` (día 0) hasta `today + days`: el saldo de hoy, más los
 * recurrentes de cada fecha, más el promedio diario de lo variable (`variable.total` repartido en
 * `variable.days`). El promedio se acumula como `total × i / días` para no arrastrar redondeos.
 * Lo programado antes de hoy (pendiente de confirmar) cuenta hoy.
 */
export function projectBalance(
  start: bigint,
  today: CivilDate,
  days: number,
  scheduled: readonly ScheduledFlow[],
  variable: { readonly total: bigint; readonly days: number },
): ProjectionPoint[] {
  const span = BigInt(Math.max(1, variable.days));
  const sorted = [...scheduled].sort((a, b) => compareCivil(a.date, b.date));
  const points: ProjectionPoint[] = [];
  let fixed = 0n;
  let next = 0;
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i);
    while (next < sorted.length && compareCivil(sorted[next]?.date ?? date, date) <= 0) {
      fixed += sorted[next]?.amount ?? 0n;
      next++;
    }
    points.push({ date, balance: start + fixed + (variable.total * BigInt(i)) / span });
  }
  return points;
}

/** Primer día en rojo, o `null` si el saldo nunca baja de cero. */
export const firstNegative = (points: readonly ProjectionPoint[]): ProjectionPoint | null =>
  points.find((p) => p.balance < 0n) ?? null;

/** El día de saldo más bajo (el primero, si hay empate). */
export function lowest(points: readonly ProjectionPoint[]): ProjectionPoint | null {
  let low: ProjectionPoint | null = null;
  for (const p of points) if (!low || p.balance < low.balance) low = p;
  return low;
}

export interface AccountProjection {
  readonly id: string;
  readonly name: string;
  readonly currency: CurrencyCode;
  readonly today: Money;
  readonly points: readonly ProjectionPoint[];
  readonly scheduled: readonly ScheduledFlow[];
  /** Lo variable (sin recurrentes) por día, en promedio. Negativo si sale más de lo que entra. */
  readonly dailyAverage: Money;
  readonly firstNegative: ProjectionPoint | null;
  readonly lowest: ProjectionPoint | null;
}

/** Días de calendario de `from` a `to`, sin que el horario de verano ni la hora del día cuenten. */
const daysBetween = (from: CivilDate, to: CivilDate) =>
  Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) /
      86_400_000,
  );

/**
 * Proyecta cada cuenta de efectivo, banco o billetera: recurrentes de esa cuenta en su moneda y el
 * promedio de los ingresos y gastos que no salieron de un recurrente. Las transferencias, los
 * ajustes de saldo y los pagos de tarjeta no se adivinan.
 */
export async function projectAccounts(
  db: SqlConnection,
  today: CivilDate,
  days = PROJECTION_DAYS,
): Promise<AccountProjection[]> {
  const accounts = (await sqliteAccounts(db).list()).filter(
    (a) => LIQUID.has(a.type) && !a.archivedAt,
  );
  const recurring = await listRecurring(db);
  const horizon = addDays(today, days);
  // Los últimos `span` días contando hoy: lo que se registró hoy ya dice algo del ritmo de gasto.
  const tomorrow = new Date(startOfDay(addDays(today, 1)));
  const out: AccountProjection[] = [];
  for (const a of accounts) {
    const balance = await sqliteAccounts(db).balance(a);

    const scheduled: ScheduledFlow[] = [];
    for (const r of recurring) {
      if (r.accountId !== a.id || r.amount.currencyCode !== a.currency) continue;
      const sign = r.kind === "expense" ? -1n : 1n;
      const pending = r.autoPost ? [] : pendingOf(r, addDays(today, -1));
      const first = upcomingOf(r, today);
      const future = first ? [first, ...occurrencesBetween(r.recurrence, first, horizon)] : [];
      for (const d of [...pending.map(() => today), ...future]) {
        if (compareCivil(d, horizon) > 0) continue;
        scheduled.push({ date: d, amount: sign * r.amount.amountMinor, name: r.name });
      }
    }

    const span = Math.min(
      LOOKBACK_DAYS,
      Math.max(MIN_LOOKBACK_DAYS, daysBetween(civilDate(a.createdAt), today)),
    );
    const from = new Date(startOfDay(addDays(today, 1 - span)));
    const row = await db.get<{ total: number }>(
      `SELECT coalesce(sum(e.amount_minor), 0) AS total
       FROM entries e
       JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL
       WHERE e.account_id = ? AND e.currency = ? AND t.occurred_at >= ? AND t.occurred_at < ?
         AND t.id NOT IN (
           SELECT transaction_id FROM recurring_occurrences WHERE transaction_id IS NOT NULL)
         AND EXISTS (
           SELECT 1 FROM entries c_e JOIN categories c ON c.id = c_e.category_id
           WHERE c_e.transaction_id = t.id AND c.kind IN ('income', 'expense'))`,
      a.id,
      a.currency,
      from.toISOString(),
      tomorrow.toISOString(),
    );
    const variable = BigInt(row?.total ?? 0);
    const points = projectBalance(balance.amountMinor, today, days, scheduled, {
      total: variable,
      days: span,
    });
    out.push({
      id: a.id,
      name: a.name,
      currency: a.currency,
      today: balance,
      points,
      scheduled: scheduled.sort((x, y) => compareCivil(x.date, y.date)),
      dailyAverage: Money.ofMinor(toWholeUnits(variable / BigInt(span), a.currency), a.currency),
      firstNegative: firstNegative(points),
      lowest: lowest(points),
    });
  }
  return out;
}

/** Redondea a la unidad entera de la moneda (pesos, dólares): un promedio no necesita centavos. */
export function toWholeUnits(minor: bigint, currency: CurrencyCode): bigint {
  const unit = 10n ** BigInt(CURRENCIES[currency].minorUnits);
  const half = unit / 2n;
  return ((minor + (minor < 0n ? -half : half)) / unit) * unit;
}

/** Las cuentas que quedarían en rojo, primero la que se queda antes. */
export function atRisk(all: readonly AccountProjection[]): AccountProjection[] {
  const risky = all.flatMap((p) => (p.firstNegative ? [{ p, on: p.firstNegative.date }] : []));
  return risky.sort((x, y) => compareCivil(x.on, y.on)).map((x) => x.p);
}

/** Hoy en la hora del teléfono. */
export const todayCivil = (now: Date = new Date()): CivilDate => civilDate(now);
