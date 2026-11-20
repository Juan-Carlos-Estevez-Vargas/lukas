import { DomainError, type MovementKind, type Result } from "@lukas/domain";
import type { Clock } from "../accounts/accounts";
import { fromDbAmount } from "../data/ledger-sqlite";
import type { SqlConnection } from "../data/sql";
import { suggestCategory, writeMovement } from "../movements/movements";
import {
  type Capture,
  type CaptureSource,
  fingerprint,
  normalizeCapture,
  type RawCapture,
  sameMovement,
} from "./normalize";

export type CaptureStatus = "pending" | "accepted" | "dismissed" | "duplicate" | "matched";

/** Bancos por paquete de app o dominio de correo; con eso se adivina la cuenta si no hay tarjeta. */
const INSTITUTIONS: readonly { readonly pattern: RegExp; readonly institution: string }[] = [
  { pattern: /nequi/i, institution: "Nequi" },
  { pattern: /daviplata/i, institution: "Daviplata" },
  { pattern: /bancolombia|com\.todo1\.mobile/i, institution: "Bancolombia" },
  { pattern: /davivienda/i, institution: "Davivienda" },
  { pattern: /bbva/i, institution: "BBVA" },
  { pattern: /nubank|\bnu\.com|com\.nu\.production/i, institution: "Nu Colombia" },
  { pattern: /lulo/i, institution: "Lulo Bank" },
];

interface AccountRow {
  id: string;
  institution: string | null;
  last4: string | null;
  currency: string;
}

/**
 * Cuenta de la captura: la única activa con esos 4 dígitos; si no, la única activa del banco de
 * la app. Si hay dudas (dos cuentas posibles) se deja sin cuenta para que la persona elija.
 */
export async function matchAccount(db: SqlConnection, c: Capture): Promise<string | null> {
  const accounts = await db.all<AccountRow>(
    "SELECT id, institution, last4, currency FROM accounts WHERE archived_at IS NULL AND currency = ?",
    c.amount.currencyCode,
  );
  if (c.last4) {
    const byCard = accounts.filter((a) => a.last4 === c.last4);
    if (byCard.length === 1) return byCard[0]?.id ?? null;
    if (byCard.length > 1) return null;
  }
  const institution = INSTITUTIONS.find((i) => i.pattern.test(c.app ?? ""))?.institution;
  if (!institution) return null;
  const byBank = accounts.filter((a) => a.institution?.toLowerCase() === institution.toLowerCase());
  return byBank.length === 1 ? (byBank[0]?.id ?? null) : null;
}

interface CaptureRow {
  id: string;
  source: CaptureSource;
  app: string | null;
  received_at: string;
  occurred_at: string;
  kind: MovementKind;
  amount_minor: number;
  currency: string;
  merchant: string | null;
  last4: string | null;
  account_id: string | null;
  status: CaptureStatus;
  match_transaction_id: string | null;
}

const toCapture = (r: CaptureRow): Capture => ({
  source: r.source,
  app: r.app,
  receivedAt: new Date(r.received_at),
  occurredAt: new Date(r.occurred_at),
  kind: r.kind,
  amount: fromDbAmount(r.amount_minor, r.currency),
  merchant: r.merchant,
  last4: r.last4,
});

export interface IngestResult {
  readonly id: string;
  readonly status: CaptureStatus;
}

/**
 * Entrada única del pipeline: normaliza, busca si ya llegó por otra vía (queda `duplicate`), le
 * asigna cuenta y, si ya hay un movimiento registrado igual, lo anota para preguntarle a la
 * persona. `null` si la captura no se pudo leer.
 */
export async function ingestCapture(
  db: SqlConnection,
  raw: RawCapture,
  clock: Clock,
): Promise<IngestResult | null> {
  const capture = normalizeCapture(raw);
  if (!capture) return null;
  const at = capture.occurredAt.getTime();
  const day = 86_400_000;
  const nearby = await db.all<CaptureRow>(
    `SELECT * FROM captures
     WHERE status <> 'duplicate' AND amount_minor = ? AND currency = ? AND occurred_at >= ? AND occurred_at <= ?
     ORDER BY occurred_at`,
    Number(capture.amount.amountMinor),
    capture.amount.currencyCode,
    new Date(at - day).toISOString(),
    new Date(at + day).toISOString(),
  );
  const original = nearby.find((r) => sameMovement(toCapture(r), capture));
  const id = clock.newId();
  const accountId = original?.account_id ?? (await matchAccount(db, capture));
  const status: CaptureStatus = original ? "duplicate" : "pending";
  const match = !original && accountId ? await registeredMatch(db, accountId, capture) : null;
  if (original && original.status === "pending" && !original.account_id && accountId) {
    await db.run("UPDATE captures SET account_id = ? WHERE id = ?", accountId, original.id);
  }
  await db.run(
    `INSERT INTO captures (id, source, app, received_at, occurred_at, kind, amount_minor, currency,
       merchant, last4, account_id, fingerprint, status, duplicate_of, match_transaction_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    capture.source,
    capture.app,
    capture.receivedAt.toISOString(),
    capture.occurredAt.toISOString(),
    capture.kind,
    Number(capture.amount.amountMinor),
    capture.amount.currencyCode,
    capture.merchant,
    capture.last4,
    accountId,
    fingerprint(capture),
    status,
    original?.id ?? null,
    match,
    clock.now().toISOString(),
  );
  return { id, status };
}

/** Un movimiento ya registrado en la cuenta, del mismo tipo y monto, cerca de la hora. */
async function registeredMatch(
  db: SqlConnection,
  accountId: string,
  c: Capture,
): Promise<string | null> {
  const signed = c.kind === "expense" ? -c.amount.amountMinor : c.amount.amountMinor;
  const window = c.source === "statement" ? 86_400_000 : 12 * 3_600_000;
  const at = c.occurredAt.getTime();
  const row = await db.get<{ id: string }>(
    `SELECT t.id FROM transactions t
     JOIN entries e ON e.transaction_id = t.id
     WHERE t.deleted_at IS NULL AND e.account_id = ? AND e.amount_minor = ?
       AND t.occurred_at >= ? AND t.occurred_at <= ?
       AND t.id NOT IN (SELECT transaction_id FROM captures WHERE transaction_id IS NOT NULL)
       AND t.id NOT IN (SELECT match_transaction_id FROM captures WHERE match_transaction_id IS NOT NULL)
     ORDER BY abs(julianday(t.occurred_at) - julianday(?)) LIMIT 1`,
    accountId,
    Number(signed),
    new Date(at - window).toISOString(),
    new Date(at + window).toISOString(),
    c.occurredAt.toISOString(),
  );
  return row?.id ?? null;
}

export interface InboxItem extends Capture {
  readonly id: string;
  readonly accountId: string | null;
  /** Movimiento ya registrado que parece ser este: "¿ya lo anotaste?". */
  readonly matchTransactionId: string | null;
  readonly categoryId: string | null;
}

/** Lo que espera revisión, lo más reciente primero, con la categoría sugerida. */
export async function inbox(db: SqlConnection): Promise<InboxItem[]> {
  const rows = await db.all<CaptureRow>(
    "SELECT * FROM captures WHERE status = 'pending' ORDER BY occurred_at DESC LIMIT 200",
  );
  const out: InboxItem[] = [];
  for (const r of rows) {
    const c = toCapture(r);
    out.push({
      ...c,
      id: r.id,
      accountId: r.account_id,
      matchTransactionId: r.match_transaction_id,
      categoryId: c.merchant ? await suggestCategory(db, c.merchant, c.kind) : null,
    });
  }
  return out;
}

export const pendingCount = async (db: SqlConnection): Promise<number> =>
  (await db.get<{ n: number }>("SELECT count(*) AS n FROM captures WHERE status = 'pending'"))?.n ??
  0;

const FALLBACK: Record<MovementKind, string> = {
  expense: "default.otros_gastos",
  income: "default.otros_ingresos",
};

const notPending = () => new DomainError("not_found", "La captura ya no está por revisar");

/** Registra la captura como movimiento (con la cuenta y categoría que eligió la persona). */
export async function acceptCapture(
  db: SqlConnection,
  id: string,
  choice: { readonly accountId: string; readonly categoryId?: string | null },
  clock: Clock,
): Promise<Result<string, DomainError>> {
  let result: Result<string, DomainError> = { ok: false, error: notPending() };
  await db.transaction(async (tx) => {
    const row = await tx.get<CaptureRow>(
      "SELECT * FROM captures WHERE id = ? AND status = 'pending'",
      id,
    );
    if (!row) return;
    const c = toCapture(row);
    const written = await writeMovement(
      tx,
      {
        kind: c.kind,
        accountId: choice.accountId,
        categoryId: choice.categoryId ?? FALLBACK[c.kind],
        amount: c.amount,
        occurredAt: c.occurredAt,
        merchant: c.merchant,
        source: c.source,
      },
      clock,
    );
    if (!written.ok) {
      result = written;
      return;
    }
    await tx.run(
      "UPDATE captures SET status = 'accepted', account_id = ?, transaction_id = ? WHERE id = ?",
      choice.accountId,
      written.value.id,
      id,
    );
    result = { ok: true, value: written.value.id };
  });
  return result;
}

/** "Ya lo había anotado": se une al movimiento existente y no se crea otro. */
export async function linkCapture(db: SqlConnection, id: string): Promise<boolean> {
  const row = await db.get<{ id: string }>(
    "SELECT id FROM captures WHERE id = ? AND status = 'pending' AND match_transaction_id IS NOT NULL",
    id,
  );
  if (!row) return false;
  await db.run(
    "UPDATE captures SET status = 'matched', transaction_id = match_transaction_id WHERE id = ?",
    id,
  );
  return true;
}

/** No es un movimiento (o no interesa): sale de la bandeja. */
export async function dismissCapture(db: SqlConnection, id: string): Promise<boolean> {
  const row = await db.get<{ id: string }>(
    "SELECT id FROM captures WHERE id = ? AND status = 'pending'",
    id,
  );
  if (!row) return false;
  await db.run("UPDATE captures SET status = 'dismissed' WHERE id = ?", id);
  return true;
}
