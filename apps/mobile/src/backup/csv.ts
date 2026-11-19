import type { Money } from "@lukas/domain";
import { fromDbAmount } from "../data/ledger-sqlite";
import type { SqlConnection } from "../data/sql";
import { KIND_SQL } from "../movements/filters";

export interface CsvLabels {
  readonly headers: readonly string[];
  readonly kinds: Record<keyof typeof KIND_SQL, string>;
}

const SEPARATOR = ";";

/**
 * Celda segura: entre comillas si hace falta y sin fórmulas. Un texto que empieza con `=`, `+`,
 * `-`, `@` o tabulador se antepone con `'` para que Excel no lo ejecute (inyección CSV).
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Monto con coma decimal y sin separador de miles, como lo lee Excel en español. */
const amountCell = (m: Money): string => m.toDecimalString().replace(".", ",");

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

interface Row {
  id: string;
  occurred_at: string;
  kind: keyof typeof KIND_SQL;
  account: string;
  amount_minor: number;
  currency: string;
  categories: string | null;
  merchant: string | null;
  notes: string | null;
  tags: string | null;
}

/**
 * Todos los movimientos en CSV (separado por `;`, UTF-8 con BOM para Excel): una fila por cada
 * cuenta que toca el movimiento, así una transferencia sale como salida y entrada.
 */
export async function movementsCsv(db: SqlConnection, labels: CsvLabels): Promise<string> {
  const kindCase = (Object.keys(KIND_SQL) as (keyof typeof KIND_SQL)[])
    .map((k) => `WHEN ${KIND_SQL[k]} THEN '${k}'`)
    .join(" ");
  const rows = await db.all<Row>(
    `SELECT t.id, t.occurred_at, CASE ${kindCase} END AS kind, a.name AS account,
       e.amount_minor, e.currency, t.merchant, t.notes,
       (SELECT group_concat(c.name, ' + ') FROM entries ce JOIN categories c ON c.id = ce.category_id
         WHERE ce.transaction_id = t.id AND c.is_system = 0) AS categories,
       (SELECT group_concat(g.name, ', ') FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id
         WHERE tt.transaction_id = t.id) AS tags
     FROM transactions t
     JOIN entries e ON e.transaction_id = t.id AND e.account_id IS NOT NULL
     JOIN accounts a ON a.id = e.account_id
     WHERE t.deleted_at IS NULL
     ORDER BY t.occurred_at, t.id, e.amount_minor`,
  );
  const lines = [labels.headers.map(csvCell).join(SEPARATOR)];
  for (const r of rows) {
    lines.push(
      [
        localDate(r.occurred_at),
        csvCell(labels.kinds[r.kind]),
        csvCell(r.account),
        csvCell(r.categories ?? ""),
        csvCell(r.merchant ?? ""),
        csvCell(r.notes ?? ""),
        amountCell(fromDbAmount(r.amount_minor, r.currency)),
        r.currency,
        csvCell(r.tags ?? ""),
      ].join(SEPARATOR),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
