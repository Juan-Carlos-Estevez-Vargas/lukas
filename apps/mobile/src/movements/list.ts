import { type CivilDate, type CurrencyCode, isCurrencyCode, Money } from "@lukas/domain";
import { civilDate } from "../accounts/credit-card";
import type { SqlConnection } from "../data/sql";
import {
  filtersToSpec,
  KIND_SQL,
  type ListKind,
  type MovementFilters,
  type MovementRow,
} from "./filters";

interface TxRow {
  id: string;
  occurred_at: string;
  description: string;
  merchant: string | null;
  notes: string | null;
  search_text: string;
  kind: ListKind;
  receipts: number;
}

interface EntryRow {
  transaction_id: string;
  account_id: string | null;
  account_name: string | null;
  category_id: string | null;
  category_name: string | null;
  category_kind: string | null;
  amount_minor: number;
  currency: string;
}

export const PAGE_SIZE = 50;

const KIND_CASE = `CASE
  WHEN ${KIND_SQL.transfer} THEN 'transfer'
  WHEN ${KIND_SQL.expense} THEN 'expense'
  WHEN ${KIND_SQL.income} THEN 'income'
  ELSE 'adjustment' END`;

const currencyOf = (code: string): CurrencyCode => {
  if (!isCurrencyCode(code)) throw new Error(`Moneda desconocida: ${code}`);
  return code;
};

/** Monto que se muestra: lo gastado (negativo), lo recibido, o lo que llegó en una transferencia. */
function displayAmount(kind: ListKind, entries: readonly EntryRow[]): Money {
  const sum = (rows: readonly EntryRow[], negate: boolean) => {
    const first = rows[0];
    const code = currencyOf(first?.currency ?? "COP");
    const total = rows
      .filter((e) => e.currency === code)
      .reduce((acc, e) => acc + BigInt(e.amount_minor), 0n);
    return Money.ofMinor(negate ? -total : total, code);
  };
  if (kind === "expense" || kind === "income") {
    return sum(
      entries.filter((e) => e.category_kind === kind),
      true,
    );
  }
  if (kind === "transfer")
    return sum(
      entries.filter((e) => e.account_id && e.amount_minor > 0),
      false,
    );
  return sum(
    entries.filter((e) => e.account_id),
    false,
  );
}

/** Una página de movimientos que cumplen los filtros, del más reciente al más antiguo. */
export async function listMovements(
  db: SqlConnection,
  filters: MovementFilters,
  page = 0,
): Promise<MovementRow[]> {
  const spec = filtersToSpec(filters);
  const txs = await db.all<TxRow>(
    `SELECT t.id, t.occurred_at, t.description, t.merchant, t.notes, t.search_text,
       ${KIND_CASE} AS kind,
       (SELECT count(*) FROM attachments a WHERE a.transaction_id = t.id) AS receipts
     FROM transactions t
     WHERE t.deleted_at IS NULL AND ${spec.where}
     ORDER BY t.occurred_at DESC, t.id DESC
     LIMIT ? OFFSET ?`,
    ...spec.args,
    PAGE_SIZE,
    page * PAGE_SIZE,
  );
  if (txs.length === 0) return [];
  const marks = txs.map(() => "?").join(", ");
  const ids = txs.map((t) => t.id);
  const [entries, tags] = await Promise.all([
    db.all<EntryRow>(
      `SELECT e.transaction_id, e.account_id, a.name AS account_name, e.category_id,
         c.name AS category_name, c.kind AS category_kind, e.amount_minor, e.currency
       FROM entries e
       LEFT JOIN accounts a ON a.id = e.account_id
       LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.transaction_id IN (${marks})
       ORDER BY e.rowid`,
      ...ids,
    ),
    db.all<{ transaction_id: string; name: string }>(
      `SELECT tt.transaction_id, g.name FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id
       WHERE tt.transaction_id IN (${marks}) ORDER BY g.name`,
      ...ids,
    ),
  ]);
  return txs.map((t) => {
    const own = entries.filter((e) => e.transaction_id === t.id);
    const unique = (values: (string | null)[]) => [
      ...new Set(values.filter((v): v is string => v !== null)),
    ];
    const categoryNames = unique(
      own
        .filter((e) => e.category_kind === "expense" || e.category_kind === "income")
        .map((e) => e.category_name),
    );
    const accountNames = unique(own.map((e) => e.account_name));
    const title =
      t.merchant ??
      (t.description ||
        (t.kind === "transfer" ? accountNames.join(" → ") : (categoryNames[0] ?? "")));
    return {
      id: t.id,
      occurredAt: new Date(t.occurred_at),
      title,
      merchant: t.merchant,
      notes: t.notes,
      kind: t.kind,
      amount: displayAmount(t.kind, own),
      accountIds: unique(own.map((e) => e.account_id)),
      accountNames,
      categoryIds: unique(own.map((e) => e.category_id)),
      categoryNames,
      tags: tags.filter((g) => g.transaction_id === t.id).map((g) => g.name),
      hasReceipt: t.receipts > 0,
      entryAmounts: own.map((e) => BigInt(Math.abs(e.amount_minor))),
      searchText: t.search_text,
    };
  });
}

export interface DaySection {
  readonly day: CivilDate;
  readonly key: string;
  readonly rows: readonly MovementRow[];
  /** Neto del día en pesos (ingresos menos gastos); sin transferencias ni otras monedas. */
  readonly net: Money;
}

/** Agrupa por día del calendario del teléfono, conservando el orden de la lista. */
export function groupByDay(rows: readonly MovementRow[]): DaySection[] {
  const sections: { day: CivilDate; key: string; rows: MovementRow[] }[] = [];
  for (const row of rows) {
    const day = civilDate(row.occurredAt);
    const key = `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
    const last = sections[sections.length - 1];
    if (last?.key === key) last.rows.push(row);
    else sections.push({ day, key, rows: [row] });
  }
  return sections.map((s) => ({
    ...s,
    net: s.rows
      .filter(
        (r) => (r.kind === "expense" || r.kind === "income") && r.amount.currencyCode === "COP",
      )
      .reduce((acc, r) => acc.add(r.amount), Money.zero("COP")),
  }));
}
