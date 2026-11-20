import {
  addDays,
  type CivilDate,
  type DomainError,
  daysBetween,
  type Frequency,
  type Money,
  merchantKey,
  nextOccurrence,
  type Result,
} from "@lukas/domain";
import type { Clock } from "../accounts/accounts";
import { civilDate } from "../accounts/credit-card";
import { fromDbAmount } from "../data/ledger-sqlite";
import { sqlitePreferences } from "../data/preferences";
import type { SqlConnection } from "../data/sql";
import { createRecurring, listRecurring, type Recurring } from "../recurring/recurring";

/** Cargos del mismo comercio que se repiten con un periodo reconocible. */
export interface SubscriptionSuggestion {
  /** Identifica la sugerencia para descartarla: comercio y cuenta. */
  readonly key: string;
  readonly merchant: string;
  readonly accountId: string;
  readonly categoryId: string;
  /** Monto del último cargo. */
  readonly amount: Money;
  readonly frequency: Frequency;
  /** Fechas de los cargos que forman la serie, la más reciente al final. */
  readonly dates: readonly CivilDate[];
  readonly nextOn: CivilDate;
}

/** Dos cargos iguales al mismo comercio, desde la misma cuenta y muy seguidos. */
export interface DuplicateCharge {
  readonly key: string;
  readonly merchant: string;
  readonly accountId: string;
  readonly amount: Money;
  readonly transactionIds: readonly [string, string];
  readonly occurredAt: Date;
}

// Días entre cargos que se aceptan para cada periodo, y cuánto puede tardar el siguiente antes de
// dar la suscripción por cancelada.
const PERIODS: readonly { frequency: Frequency; min: number; max: number; stale: number }[] = [
  { frequency: "weekly", min: 6, max: 8, stale: 12 },
  { frequency: "monthly", min: 26, max: 35, stale: 45 },
  { frequency: "yearly", min: 350, max: 380, stale: 400 },
];

/** Un cobro cambia un poco (IVA, TRM): hasta 15 % se considera el mismo. */
const SAME_AMOUNT = 0.15;
const DUPLICATE_WINDOW_MS = 24 * 3_600_000;
const DISMISSED = "insights.dismissed";

interface ChargeRow {
  id: string;
  occurred_at: string;
  merchant: string;
  account_id: string;
  category_id: string;
  amount_minor: number;
  currency: string;
}

/** Gastos con comercio desde `since`, sin los que registró un recurrente. */
async function charges(db: SqlConnection, since: Date): Promise<ChargeRow[]> {
  return db.all<ChargeRow>(
    `SELECT t.id, t.occurred_at, t.merchant, a.account_id, c.category_id,
       -a.amount_minor AS amount_minor, a.currency
     FROM transactions t
     JOIN entries a ON a.transaction_id = t.id AND a.account_id IS NOT NULL
     JOIN entries c ON c.transaction_id = t.id AND c.category_id IS NOT NULL
     JOIN categories k ON k.id = c.category_id AND k.kind = 'expense'
     WHERE t.deleted_at IS NULL AND t.source <> 'recurring' AND t.merchant IS NOT NULL
       AND a.amount_minor < 0 AND t.occurred_at >= ?
       AND (SELECT count(*) FROM entries WHERE transaction_id = t.id) = 2
     ORDER BY t.occurred_at, t.created_at, t.id`,
    since.toISOString(),
  );
}

const similar = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * SAME_AMOUNT;

async function dismissed(db: SqlConnection): Promise<Set<string>> {
  const raw = await sqlitePreferences(db).get(DISMISSED);
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((k) => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

/** "No es una suscripción" / "Está bien": no se vuelve a mostrar. */
export async function dismissInsight(db: SqlConnection, key: string): Promise<void> {
  const keys = await dismissed(db);
  keys.add(key);
  // Solo las últimas 200: lo viejo ya no aparece de todos modos.
  await sqlitePreferences(db).set(DISMISSED, JSON.stringify([...keys].slice(-200)));
}

const covered = (r: Recurring, merchant: string, accountId: string, minor: number) =>
  merchantKey(r.name) === merchant ||
  (r.accountId === accountId && similar(Number(r.amount.amountMinor), minor));

/**
 * Busca suscripciones sin recurrente: al menos dos cargos del mismo comercio y cuenta, con montos
 * parecidos y un periodo semanal, mensual o anual, y el último todavía vigente.
 */
export async function detectSubscriptions(
  db: SqlConnection,
  today: Date,
): Promise<SubscriptionSuggestion[]> {
  const rows = await charges(db, new Date(today.getTime() - 760 * 86_400_000));
  const skip = await dismissed(db);
  const active = (await listRecurring(db)).filter((r) => r.kind === "expense");
  const groups = new Map<string, ChargeRow[]>();
  for (const r of rows) {
    const key = `sub:${merchantKey(r.merchant)}:${r.account_id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: SubscriptionSuggestion[] = [];
  const now = civilDate(today);
  for (const [key, list] of groups) {
    const last = list[list.length - 1];
    if (!last || list.length < 2 || skip.has(key)) continue;
    const name = merchantKey(last.merchant);
    if (active.some((r) => covered(r, name, last.account_id, last.amount_minor))) continue;
    const lastOn = civilDate(new Date(last.occurred_at));
    for (const period of PERIODS) {
      // La serie se arma hacia atrás desde el último cargo mientras el periodo y el monto encajen.
      const series = [last];
      for (let i = list.length - 2; i >= 0; i--) {
        const prev = list[i];
        const next = series[0];
        if (!prev || !next) break;
        const gap = daysBetween(
          civilDate(new Date(prev.occurred_at)),
          civilDate(new Date(next.occurred_at)),
        );
        if (gap < period.min) continue;
        if (gap > period.max || !similar(prev.amount_minor, last.amount_minor)) break;
        series.unshift(prev);
      }
      if (series.length < 2 || daysBetween(lastOn, now) > period.stale) continue;
      const nextOn =
        nextOccurrence(
          { frequency: period.frequency, every: 1, startsOn: lastOn, endsOn: null },
          addDays(lastOn, 1),
        ) ?? addDays(lastOn, period.min);
      out.push({
        key,
        merchant: last.merchant,
        accountId: last.account_id,
        categoryId: last.category_id,
        amount: fromDbAmount(last.amount_minor, last.currency),
        frequency: period.frequency,
        dates: series.map((s) => civilDate(new Date(s.occurred_at))),
        nextOn,
      });
      break;
    }
  }
  return out.sort((a, b) => a.merchant.localeCompare(b.merchant));
}

/** Convierte la sugerencia en un recurrente que avisa (no se registra solo) desde el próximo cobro. */
export async function acceptSubscription(
  db: SqlConnection,
  s: SubscriptionSuggestion,
  clock: Clock,
): Promise<Result<Recurring, DomainError>> {
  const today = civilDate(clock.now());
  return createRecurring(
    db,
    {
      name: s.merchant,
      kind: "expense",
      accountId: s.accountId,
      categoryId: s.categoryId,
      amount: s.amount,
      recurrence: { frequency: s.frequency, every: 1, startsOn: s.nextOn, endsOn: null },
      autoPost: false,
      remind: true,
    },
    today,
    clock,
  );
}

/** Cargos repetidos (mismo comercio, cuenta y monto exacto en menos de 24 h) de los últimos días. */
export async function detectDuplicates(
  db: SqlConnection,
  today: Date,
  days = 7,
): Promise<DuplicateCharge[]> {
  const rows = await charges(
    db,
    new Date(today.getTime() - days * 86_400_000 - DUPLICATE_WINDOW_MS),
  );
  const skip = await dismissed(db);
  const out: DuplicateCharge[] = [];
  const used = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    if (!a || used.has(a.id)) continue;
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j];
      if (!b) break;
      const gap = new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
      if (gap > DUPLICATE_WINDOW_MS) break;
      if (
        used.has(b.id) ||
        b.account_id !== a.account_id ||
        b.amount_minor !== a.amount_minor ||
        b.currency !== a.currency ||
        merchantKey(b.merchant) !== merchantKey(a.merchant)
      ) {
        continue;
      }
      const key = `dup:${a.id}:${b.id}`;
      used.add(a.id);
      used.add(b.id);
      if (
        skip.has(key) ||
        new Date(b.occurred_at).getTime() < today.getTime() - days * 86_400_000
      ) {
        break;
      }
      out.push({
        key,
        merchant: b.merchant,
        accountId: b.account_id,
        amount: fromDbAmount(b.amount_minor, b.currency),
        transactionIds: [a.id, b.id],
        occurredAt: new Date(b.occurred_at),
      });
      break;
    }
  }
  return out.reverse();
}
