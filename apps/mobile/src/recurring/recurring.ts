import {
  addDays,
  type CivilDate,
  compareCivil,
  DomainError,
  type Frequency,
  isValidCivil,
  type Money,
  type MovementKind,
  nextOccurrence,
  occurrencesBetween,
  type Recurrence,
  type Result,
  type Transaction,
  validateRecurrence,
} from "@lukas/domain";
import type { Clock } from "../accounts/accounts";
import { fromDbAmount, sqliteAccounts, toDbAmount } from "../data/ledger-sqlite";
import type { SqlConnection } from "../data/sql";
import { writeMovement } from "../movements/movements";

export interface RecurringInput {
  readonly name: string;
  readonly kind: MovementKind;
  readonly accountId: string;
  readonly categoryId: string;
  readonly amount: Money;
  readonly recurrence: Recurrence;
  /** `true`: se registra solo al vencer. `false`: solo avisa y la persona lo confirma. */
  readonly autoPost: boolean;
  readonly remind: boolean;
}

export interface Recurring extends RecurringInput {
  readonly id: string;
  /** Última ocurrencia registrada u omitida. */
  readonly postedThrough: CivilDate | null;
}

/** "2026-03-05" ⇄ fecha civil. */
export const civilKey = (d: CivilDate): string =>
  `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

export function parseCivil(text: string): CivilDate | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (!m) return null;
  const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return isValidCivil(d) ? d : null;
}

const civil = (text: string): CivilDate => {
  const d = parseCivil(text);
  if (!d) throw new Error(`Fecha guardada inválida: ${text}`);
  return d;
};

/** Mediodía local del día: lejos de la medianoche para que ningún cambio de zona lo mueva. */
export const noonOf = (d: CivilDate): Date => new Date(d.year, d.month - 1, d.day, 12);

interface Row {
  id: string;
  name: string;
  kind: MovementKind;
  account_id: string;
  category_id: string;
  amount_minor: number;
  currency: string;
  frequency: Frequency;
  every: number;
  starts_on: string;
  ends_on: string | null;
  auto_post: number;
  remind: number;
  posted_through: string | null;
}

const fromRow = (r: Row): Recurring => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  accountId: r.account_id,
  categoryId: r.category_id,
  amount: fromDbAmount(r.amount_minor, r.currency),
  recurrence: {
    frequency: r.frequency,
    every: r.every,
    startsOn: civil(r.starts_on),
    endsOn: r.ends_on ? civil(r.ends_on) : null,
  },
  autoPost: r.auto_post === 1,
  remind: r.remind === 1,
  postedThrough: r.posted_through ? civil(r.posted_through) : null,
});

const fail = (code: string, message: string): Result<never, DomainError> => ({
  ok: false,
  error: new DomainError(code, message),
});

/**
 * Crea un recurrente. Si empieza en el pasado no se rellena la historia: la primera ocurrencia
 * que se registra es la de hoy o la siguiente.
 */
export async function createRecurring(
  db: SqlConnection,
  input: RecurringInput,
  today: CivilDate,
  clock: Clock,
): Promise<Result<Recurring, DomainError>> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) return fail("recurring_name_required", "Ponle un nombre");
  if (input.amount.isZero() || input.amount.isNegative()) {
    return fail("invalid_amount", "El monto debe ser mayor que cero");
  }
  const rule = validateRecurrence(input.recurrence);
  if (!rule.ok) return rule;
  const account = await sqliteAccounts(db).get(input.accountId);
  if (!account) return fail("account_not_found", "No existe la cuenta");
  if (account.archivedAt) return fail("account_archived", "La cuenta está archivada");
  if (account.currency !== input.amount.currencyCode) {
    return fail("currency_mismatch", "El monto debe estar en la moneda de la cuenta");
  }
  const category = await db.get<{ kind: string }>(
    "SELECT kind FROM categories WHERE id = ? AND archived_at IS NULL AND is_system = 0",
    input.categoryId,
  );
  if (category?.kind !== input.kind) {
    return fail("invalid_category", "La categoría no corresponde al movimiento");
  }
  const postedThrough =
    compareCivil(input.recurrence.startsOn, today) < 0 ? addDays(today, -1) : null;
  const id = clock.newId();
  const now = clock.now().toISOString();
  const r = input.recurrence;
  await db.run(
    `INSERT INTO recurring (id, name, kind, account_id, category_id, amount_minor, currency,
       frequency, every, starts_on, ends_on, auto_post, remind, posted_through, created_at,
       updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    name,
    input.kind,
    input.accountId,
    input.categoryId,
    toDbAmount(input.amount),
    input.amount.currencyCode,
    r.frequency,
    r.every,
    civilKey(r.startsOn),
    r.endsOn ? civilKey(r.endsOn) : null,
    input.autoPost ? 1 : 0,
    input.remind ? 1 : 0,
    postedThrough ? civilKey(postedThrough) : null,
    now,
    now,
  );
  return { ok: true, value: { ...input, name, id, postedThrough } };
}

export async function listRecurring(db: SqlConnection): Promise<Recurring[]> {
  const rows = await db.all<Row>(
    "SELECT * FROM recurring WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE",
  );
  return rows.map(fromRow);
}

export async function recurringById(db: SqlConnection, id: string): Promise<Recurring | null> {
  const row = await db.get<Row>("SELECT * FROM recurring WHERE id = ?", id);
  return row ? fromRow(row) : null;
}

export async function archiveRecurring(db: SqlConnection, id: string, clock: Clock) {
  const now = clock.now().toISOString();
  await db.run("UPDATE recurring SET archived_at = ?, updated_at = ? WHERE id = ?", now, now, id);
}

/** Ocurrencias vencidas que aún no se registran ni se omiten (como mucho 60). */
export const pendingOf = (r: Recurring, today: CivilDate): CivilDate[] =>
  occurrencesBetween(r.recurrence, r.postedThrough, today, 60);

/** Siguiente ocurrencia en `from` o después que aún no esté registrada. */
export function upcomingOf(r: Recurring, from: CivilDate): CivilDate | null {
  const after = r.postedThrough ? addDays(r.postedThrough, 1) : from;
  return nextOccurrence(r.recurrence, compareCivil(after, from) > 0 ? after : from);
}

async function markOccurrence(
  tx: SqlConnection,
  r: Recurring,
  on: CivilDate,
  transactionId: string | null,
  clock: Clock,
): Promise<void> {
  const key = civilKey(on);
  const now = clock.now().toISOString();
  await tx.run(
    `INSERT INTO recurring_occurrences (recurring_id, occurs_on, transaction_id, created_at)
     VALUES (?, ?, ?, ?)`,
    r.id,
    key,
    transactionId,
    now,
  );
  // Nunca retrocede: registrar una ocurrencia vieja no reabre las siguientes.
  await tx.run(
    `UPDATE recurring SET posted_through = max(coalesce(posted_through, ''), ?), updated_at = ?
     WHERE id = ?`,
    key,
    now,
    r.id,
  );
}

const alreadyDone = async (tx: SqlConnection, r: Recurring, on: CivilDate) =>
  (await tx.get(
    "SELECT 1 AS x FROM recurring_occurrences WHERE recurring_id = ? AND occurs_on = ?",
    r.id,
    civilKey(on),
  )) !== null;

/**
 * Registra la ocurrencia de un día como movimiento, de forma atómica e idempotente: si ese día
 * ya se registró u omitió, devuelve `null` sin escribir nada.
 */
export async function postOccurrence(
  db: SqlConnection,
  r: Recurring,
  on: CivilDate,
  clock: Clock,
): Promise<Result<Transaction | null, DomainError>> {
  let result: Result<Transaction | null, DomainError> = { ok: true, value: null };
  await db.transaction(async (tx) => {
    if (await alreadyDone(tx, r, on)) return;
    const written = await writeMovement(
      tx,
      {
        kind: r.kind,
        accountId: r.accountId,
        categoryId: r.categoryId,
        amount: r.amount,
        occurredAt: noonOf(on),
        merchant: r.name,
        source: "recurring",
      },
      clock,
    );
    result = written;
    if (written.ok) await markOccurrence(tx, r, on, written.value.id, clock);
  });
  return result;
}

/** Omite una ocurrencia (p. ej. ese mes no se pagó): no vuelve a aparecer como pendiente. */
export async function skipOccurrence(
  db: SqlConnection,
  r: Recurring,
  on: CivilDate,
  clock: Clock,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await alreadyDone(tx, r, on))) await markOccurrence(tx, r, on, null, clock);
  });
}

export interface PostRun {
  readonly posted: number;
  /** Recurrentes que no se pudieron registrar (cuenta archivada, categoría borrada…). */
  readonly failed: readonly string[];
}

/** Registra todo lo vencido de los recurrentes automáticos. Se llama al abrir la app. */
export async function postDueRecurring(
  db: SqlConnection,
  today: CivilDate,
  clock: Clock,
): Promise<PostRun> {
  let posted = 0;
  const failed: string[] = [];
  for (const r of await listRecurring(db)) {
    if (!r.autoPost) continue;
    for (const on of pendingOf(r, today)) {
      const res = await postOccurrence(db, r, on, clock);
      if (!res.ok) {
        failed.push(r.id);
        break;
      }
      if (res.value) posted++;
    }
  }
  return { posted, failed };
}
