import type { CivilDate, CurrencyCode, RateTable } from "@lukas/domain";
import type { SqlConnection } from "../data/sql";
import { civilKey } from "../recurring/recurring";

export interface StoredRate {
  /** Unidades de pesos por un dólar, en texto decimal exacto. */
  readonly rate: string;
  /** Día de la tasa (AAAA-MM-DD). */
  readonly day: string;
  readonly source: string;
}

/** Puerto hacia la API: TRM de un día. `null` si no la hay o no hay conexión. */
export interface RatesClient {
  usdCop(day: string): Promise<StoredRate | null>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const DECIMAL = /^\d{1,12}(\.\d{1,6})?$/;

/** Cliente HTTP de `GET /v1/rates/usd-cop`. Nunca lanza: sin red devuelve `null`. */
export const createRatesClient = (baseUrl: string, fetchImpl: Fetch = fetch): RatesClient => ({
  async usdCop(day) {
    try {
      const res = await fetchImpl(`${baseUrl}/v1/rates/usd-cop?day=${encodeURIComponent(day)}`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as Partial<Record<string, unknown>>;
      const { rate, rateDay, source } = body;
      if (typeof rate !== "string" || !DECIMAL.test(rate)) return null;
      if (typeof rateDay !== "string" || typeof source !== "string") return null;
      return { rate, day: rateDay, source };
    } catch {
      return null;
    }
  },
});

export async function latestRate(
  db: SqlConnection,
  base: CurrencyCode,
  quote: CurrencyCode,
): Promise<StoredRate | null> {
  return db.get<StoredRate>(
    `SELECT rate, day, source FROM exchange_rates WHERE base = ? AND quote = ?
     ORDER BY day DESC LIMIT 1`,
    base,
    quote,
  );
}

export async function saveRate(
  db: SqlConnection,
  base: CurrencyCode,
  quote: CurrencyCode,
  rate: StoredRate,
  now: Date,
): Promise<void> {
  await db.run(
    `INSERT INTO exchange_rates (base, quote, day, rate, source, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (base, quote, day) DO UPDATE SET rate = excluded.rate,
       source = excluded.source, fetched_at = excluded.fetched_at`,
    base,
    quote,
    rate.day,
    rate.rate,
    rate.source,
    now.toISOString(),
  );
}

/** ¿Hay alguna cuenta activa en dólares? Solo entonces vale la pena pedir la TRM. */
export async function needsUsd(db: SqlConnection): Promise<boolean> {
  return (
    (await db.get(
      "SELECT 1 AS x FROM accounts WHERE currency = 'USD' AND archived_at IS NULL LIMIT 1",
    )) !== null
  );
}

/**
 * Trae la TRM de hoy si aún no está guardada y hay cuentas en dólares. Sin conexión no pasa nada:
 * se sigue usando la última guardada.
 */
export async function refreshRates(
  db: SqlConnection,
  client: RatesClient,
  today: CivilDate,
  now: Date,
): Promise<void> {
  if (!(await needsUsd(db))) return;
  const day = civilKey(today);
  if ((await latestRate(db, "USD", "COP"))?.day === day) return;
  const fresh = await client.usdCop(day);
  if (fresh) await saveRate(db, "USD", "COP", fresh, now);
}

/** Tasas hacia pesos para convertir en reportes y patrimonio. */
export async function copRates(
  db: SqlConnection,
): Promise<{ table: RateTable; usd: StoredRate | null }> {
  const usd = await latestRate(db, "USD", "COP");
  return { table: new Map(usd ? [["USD", usd.rate] as const] : []), usd };
}
