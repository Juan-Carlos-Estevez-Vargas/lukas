import { Money, type TaxYearFigures } from "@lukas/domain";
import { startOfDay } from "../accounts/credit-card";
import { sqlitePreferences } from "../data/preferences";
import type { SqlConnection } from "../data/sql";

/**
 * Cifras del año gravable para la ayuda tributaria, sacadas de la base local. Solo cuentan
 * movimientos en pesos: la DIAN pide todo en COP y las cuentas en otra moneda se avisan aparte.
 */

const ASSET_TYPES = "('cash', 'bank', 'digital_wallet', 'investment', 'other_asset')";
const DEPOSIT_TYPES = "('bank', 'digital_wallet', 'investment')";

const range = (year: number) =>
  [
    startOfDay({ year, month: 1, day: 1 }),
    startOfDay({ year: year + 1, month: 1, day: 1 }),
  ] as const;

const cop = (minor: number | null | undefined) => Money.ofMinor(BigInt(minor ?? 0), "COP");

/** Transacciones que no son saldos iniciales ni ajustes (no tocan categorías de patrimonio). */
const NOT_EQUITY = `NOT EXISTS (
  SELECT 1 FROM entries q JOIN categories qc ON qc.id = q.category_id
   WHERE q.transaction_id = t.id AND qc.kind = 'equity')`;

export async function taxFigures(db: SqlConnection, year: number): Promise<TaxYearFigures> {
  const [from, to] = range(year);
  const one = async (sql: string, ...params: string[]) =>
    cop((await db.get<{ total: number | null }>(sql, ...params))?.total);

  // Patrimonio bruto: saldos positivos de cuentas de activo al cierre del año.
  const assets = await db.all<{ total: number }>(
    `SELECT sum(e.amount_minor) AS total
       FROM accounts a
       JOIN entries e ON e.account_id = a.id AND e.currency = 'COP'
       JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL
      WHERE a.type IN ${ASSET_TYPES} AND a.currency = 'COP' AND t.occurred_at < ?
      GROUP BY a.id`,
    to,
  );
  const grossAssets = assets
    .map((r) => cop(r.total))
    .filter((m) => !m.isNegative())
    .reduce((a, b) => a.add(b), Money.zero("COP"));

  // El ingreso entra a su categoría en negativo; el gasto, en positivo.
  const grossIncome = await one(
    `SELECT -sum(e.amount_minor) AS total
         FROM entries e
         JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL
         JOIN categories c ON c.id = e.category_id
        WHERE c.kind = 'income' AND e.currency = 'COP' AND t.occurred_at >= ? AND t.occurred_at < ?`,
    from,
    to,
  );
  const totalPurchases = await one(
    `SELECT sum(e.amount_minor) AS total
       FROM entries e
       JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL
       JOIN categories c ON c.id = e.category_id
      WHERE c.kind = 'expense' AND e.currency = 'COP' AND t.occurred_at >= ? AND t.occurred_at < ?`,
    from,
    to,
  );
  const creditCardSpending = await one(
    `SELECT -sum(e.amount_minor) AS total
       FROM entries e
       JOIN accounts a ON a.id = e.account_id AND a.type = 'credit_card'
       JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL
      WHERE e.amount_minor < 0 AND e.currency = 'COP'
        AND t.occurred_at >= ? AND t.occurred_at < ?
        AND EXISTS (SELECT 1 FROM entries x JOIN categories xc ON xc.id = x.category_id
                     WHERE x.transaction_id = t.id AND xc.kind = 'expense')`,
    from,
    to,
  );
  const deposits = await one(
    `SELECT sum(e.amount_minor) AS total
       FROM entries e
       JOIN accounts a ON a.id = e.account_id AND a.type IN ${DEPOSIT_TYPES}
       JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL
      WHERE e.amount_minor > 0 AND e.currency = 'COP'
        AND t.occurred_at >= ? AND t.occurred_at < ? AND ${NOT_EQUITY}`,
    from,
    to,
  );
  return { grossAssets, grossIncome, creditCardSpending, totalPurchases, deposits };
}

/** Hay cuentas activas en otra moneda que no entran en las cifras. */
export async function hasForeignAccounts(db: SqlConnection): Promise<boolean> {
  return (
    (await db.get<{ one: number }>(
      "SELECT 1 AS one FROM accounts WHERE currency <> 'COP' AND archived_at IS NULL LIMIT 1",
    )) !== null
  );
}

export const exemptAccount = (db: SqlConnection) => sqlitePreferences(db).get("taxes.gmfExempt");

export const setExemptAccount = (db: SqlConnection, accountId: string | null) =>
  accountId
    ? sqlitePreferences(db).set("taxes.gmfExempt", accountId)
    : sqlitePreferences(db).remove("taxes.gmfExempt");

/**
 * Lo que salió en el mes de cuentas que pagan 4×1000 (bancos y billeteras), separado entre la
 * cuenta marcada como exenta y las demás. Los pagos de tarjeta desde el banco también cuentan.
 */
export async function gmfOutflows(
  db: SqlConnection,
  year: number,
  month: number,
): Promise<{ exempt: Money; taxed: Money }> {
  const from = startOfDay({ year, month, day: 1 });
  const to = startOfDay(
    month === 12 ? { year: year + 1, month: 1, day: 1 } : { year, month: month + 1, day: 1 },
  );
  const exemptId = (await exemptAccount(db)) ?? "";
  const rows = await db.all<{ exempt: number; total: number }>(
    `SELECT (a.id = ?) AS exempt, -sum(e.amount_minor) AS total
       FROM entries e
       JOIN accounts a ON a.id = e.account_id AND a.type IN ('bank', 'digital_wallet')
       JOIN transactions t ON t.id = e.transaction_id AND t.deleted_at IS NULL
      WHERE e.amount_minor < 0 AND e.currency = 'COP'
        AND t.occurred_at >= ? AND t.occurred_at < ?
      GROUP BY (a.id = ?)`,
    exemptId,
    from,
    to,
    exemptId,
  );
  return {
    exempt: cop(rows.find((r) => r.exempt === 1)?.total),
    taxed: cop(rows.find((r) => r.exempt !== 1)?.total),
  };
}
