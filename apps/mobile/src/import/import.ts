import {
  addDays,
  type CivilDate,
  compareCivil,
  type MovementKind,
  merchantKey,
} from "@lukas/domain";
import type { Clock } from "../accounts/accounts";
import { startOfDay } from "../accounts/credit-card";
import { sqliteAccounts } from "../data/ledger-sqlite";
import type { SqlConnection } from "../data/sql";
import { suggestCategory, writeMovement } from "../movements/movements";
import { civilKey, noonOf } from "../recurring/recurring";
import type { ImportRow } from "./columns";

/**
 * - `new`: no está en Lukas; se importa.
 * - `duplicate`: ya existe igual (cuenta, día, monto y descripción); nunca se importa.
 * - `possible`: hay un movimiento del mismo día y monto con otra descripción (quizá registrado a
 *   mano); no se importa salvo que la persona lo marque.
 */
export type RowStatus = "new" | "duplicate" | "possible";

export interface PlannedRow extends ImportRow {
  readonly status: RowStatus;
  readonly kind: MovementKind;
  readonly categoryId: string;
}

export interface ImportPlan {
  readonly accountId: string;
  readonly rows: readonly PlannedRow[];
}

const FALLBACK: Record<MovementKind, string> = {
  expense: "default.otros_gastos",
  income: "default.otros_ingresos",
};

/** Lo que identifica un movimiento importado: día, monto y descripción normalizada. */
const exactKey = (day: CivilDate, minor: bigint, description: string) =>
  `${civilKey(day)}|${minor}|${merchantKey(description)}`;
const looseKey = (day: CivilDate, minor: bigint) => `${civilKey(day)}|${minor}`;

const take = (counts: Map<string, number>, key: string): boolean => {
  const n = counts.get(key) ?? 0;
  if (n <= 0) return false;
  counts.set(key, n - 1);
  return true;
};

const civilOf = (iso: string): CivilDate => {
  const d = new Date(iso);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
};

/**
 * Compara el archivo con lo que ya hay en la cuenta. Cuenta repeticiones, no solo presencia: dos
 * tintos iguales el mismo día en el archivo son dos movimientos, y si en Lukas ya hay uno, se
 * importa solo el otro. Así importar dos veces el mismo archivo no duplica nada.
 */
export async function planImport(
  db: SqlConnection,
  accountId: string,
  rows: readonly ImportRow[],
): Promise<ImportPlan> {
  const account = await sqliteAccounts(db).get(accountId);
  if (!account) throw new Error("No existe la cuenta");
  const valid = rows.filter((r) => r.amount.currencyCode === account.currency);
  const start = valid[0]?.date;
  if (!start) return { accountId, rows: [] };

  const first = valid.reduce((m, r) => (compareCivil(r.date, m) < 0 ? r.date : m), start);
  const last = valid.reduce((m, r) => (compareCivil(r.date, m) > 0 ? r.date : m), first);
  const existing = await db.all<{
    occurred_at: string;
    amount: number;
    merchant: string | null;
    description: string;
  }>(
    `SELECT t.occurred_at AS occurred_at, e.amount_minor AS amount, t.merchant AS merchant,
       t.description AS description
     FROM entries e
     JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL
     WHERE e.account_id = ? AND e.currency = ? AND t.occurred_at >= ? AND t.occurred_at < ?`,
    accountId,
    account.currency,
    // Un día de margen a cada lado por si el movimiento quedó guardado cerca de la medianoche.
    startOfDay(addDays(first, -1)),
    startOfDay(addDays(last, 2)),
  );
  const exact = new Map<string, number>();
  const loose = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const e of existing) {
    const day = civilOf(e.occurred_at);
    bump(exact, exactKey(day, BigInt(e.amount), e.merchant ?? e.description));
    bump(loose, looseKey(day, BigInt(e.amount)));
  }

  const planned: PlannedRow[] = [];
  const categories = await db.all<{ id: string; name: string; kind: string }>(
    "SELECT id, name, kind FROM categories WHERE archived_at IS NULL AND is_system = 0",
  );
  const byName = new Map(categories.map((c) => [`${c.kind}|${merchantKey(c.name)}`, c.id]));
  for (const r of valid) {
    const minor = r.amount.amountMinor;
    const kind: MovementKind = minor < 0n ? "expense" : "income";
    let status: RowStatus = "new";
    if (take(exact, exactKey(r.date, minor, r.description))) {
      take(loose, looseKey(r.date, minor));
      status = "duplicate";
    }
    planned.push({ ...r, kind, status, categoryId: "" });
  }
  // Los "posibles" se buscan después de casar los exactos, para no gastar un exacto en un posible.
  const out: PlannedRow[] = [];
  for (const r of planned) {
    const status =
      r.status === "new" && take(loose, looseKey(r.date, r.amount.amountMinor))
        ? "possible"
        : r.status;
    const named = r.category ? byName.get(`${r.kind}|${merchantKey(r.category)}`) : undefined;
    const suggested =
      named ?? (r.description ? await suggestCategory(db, r.description, r.kind) : null);
    out.push({ ...r, status, categoryId: suggested ?? FALLBACK[r.kind] });
  }
  return { accountId, rows: out };
}

/** Lo que se importa por defecto: solo lo nuevo. */
export const defaultSelection = (plan: ImportPlan): Set<number> =>
  new Set(plan.rows.filter((r) => r.status === "new").map((r) => r.line));

/**
 * Registra las filas elegidas (nunca las `duplicate`), todas o ninguna. Devuelve cuántas entraron.
 */
export async function applyImport(
  db: SqlConnection,
  plan: ImportPlan,
  selected: ReadonlySet<number>,
  clock: Clock,
): Promise<number> {
  const rows = plan.rows.filter((r) => r.status !== "duplicate" && selected.has(r.line));
  await db.transaction(async (tx) => {
    for (const r of rows) {
      const res = await writeMovement(
        tx,
        {
          kind: r.kind,
          accountId: plan.accountId,
          categoryId: r.categoryId,
          amount: r.amount.isNegative() ? r.amount.negate() : r.amount,
          occurredAt: noonOf(r.date),
          merchant: r.description ? r.description.slice(0, 120) : null,
          source: "import",
        },
        clock,
      );
      if (!res.ok) throw new Error(`Fila ${r.line}: ${res.error.message}`);
    }
  });
  return rows.length;
}
