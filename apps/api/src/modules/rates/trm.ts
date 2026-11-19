import { exchangeRates } from "@lukas/db/schema";
import { and, desc, eq, lte } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/** Tasa de un día: unidades de `quote` por una de `base`, en texto decimal exacto. */
export interface DailyRate {
  readonly base: string;
  readonly quote: string;
  /** AAAA-MM-DD. */
  readonly day: string;
  readonly rate: string;
  readonly source: string;
}

/** Puerto de la fuente oficial de la TRM. */
export interface TrmSource {
  /** TRM vigente en `day` (AAAA-MM-DD), o `null` si la fuente no la tiene. */
  rateOn(day: string): Promise<DailyRate | null>;
}

/** Puerto de almacenamiento de tasas. */
export interface RateStore {
  /** Última tasa en `day` o antes. */
  latestOnOrBefore(base: string, quote: string, day: string): Promise<DailyRate | null>;
  save(rate: DailyRate): Promise<void>;
}

export const DATOS_GOV_SOURCE = "datos.gov.co/32sa-8pi3";
const DATOS_GOV_URL = "https://www.datos.gov.co/resource/32sa-8pi3.json";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^\d{1,12}(\.\d{1,6})?$/;

export const isDay = (text: string): boolean =>
  DAY.test(text) &&
  !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) &&
  new Date(`${text}T00:00:00Z`).toISOString().startsWith(text);

/**
 * Lee la respuesta de Socrata del conjunto "TRM histórica" (Superfinanciera). Cada fila trae
 * `valor` y su vigencia; el día de la tasa es `day`, no el de la vigencia, porque la TRM del fin
 * de semana es la del viernes.
 */
export function parseSocrataTrm(json: unknown, day: string): DailyRate | null {
  if (!Array.isArray(json) || json.length === 0) return null;
  const row: unknown = json[0];
  if (typeof row !== "object" || row === null) return null;
  const valor = (row as Record<string, unknown>).valor;
  const text = typeof valor === "number" ? String(valor) : valor;
  if (typeof text !== "string" || !DECIMAL.test(text.trim())) return null;
  const rate = text.trim();
  if (Number(rate) <= 0) return null;
  return { base: "USD", quote: "COP", day, rate, source: DATOS_GOV_SOURCE };
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Adaptador de datos abiertos de Colombia (Socrata, sin llave para pocas consultas). */
export const datosGovTrm = (fetchImpl: Fetch = fetch): TrmSource => ({
  async rateOn(day) {
    const at = `${day}T00:00:00.000`;
    const params = new URLSearchParams({
      $select: "valor,vigenciadesde,vigenciahasta",
      $where: `vigenciadesde <= '${at}' AND vigenciahasta >= '${at}'`,
      $order: "vigenciadesde DESC",
      $limit: "1",
    });
    const res = await fetchImpl(`${DATOS_GOV_URL}?${params}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`datos.gov.co respondió ${res.status}`);
    return parseSocrataTrm(await res.json(), day);
  },
});

/** Almacenamiento en memoria (pruebas y desarrollo sin base de datos). */
export const memoryRateStore = (): RateStore & { readonly rows: DailyRate[] } => {
  const rows: DailyRate[] = [];
  return {
    rows,
    async latestOnOrBefore(base, quote, day) {
      return (
        rows
          .filter((r) => r.base === base && r.quote === quote && r.day <= day)
          .sort((a, b) => (a.day < b.day ? 1 : -1))[0] ?? null
      );
    },
    async save(rate) {
      const i = rows.findIndex(
        (r) => r.base === rate.base && r.quote === rate.quote && r.day === rate.day,
      );
      if (i >= 0) rows[i] = rate;
      else rows.push(rate);
    },
  };
};

/** Almacenamiento en Postgres (tabla `app.exchange_rates`), con Neon o PGlite. */
export const drizzleRateStore = <H extends PgQueryResultHKT, S extends Record<string, unknown>>(
  db: PgDatabase<H, S>,
): RateStore => ({
  async latestOnOrBefore(base, quote, day) {
    const [row] = await db
      .select()
      .from(exchangeRates)
      .where(
        and(
          eq(exchangeRates.base, base),
          eq(exchangeRates.quote, quote),
          lte(exchangeRates.day, day),
        ),
      )
      .orderBy(desc(exchangeRates.day))
      .limit(1);
    if (!row) return null;
    // Postgres devuelve numeric con todos los decimales de la escala: "4012.350000" → "4012.35".
    const rate = row.rate.includes(".") ? row.rate.replace(/\.?0+$/, "") : row.rate;
    return { base: row.base, quote: row.quote, day: row.day, rate, source: row.source };
  },
  async save(rate) {
    await db
      .insert(exchangeRates)
      .values({ ...rate, fetchedAt: new Date() })
      .onConflictDoUpdate({
        target: [exchangeRates.base, exchangeRates.quote, exchangeRates.day],
        set: { rate: rate.rate, source: rate.source, fetchedAt: new Date() },
      });
  },
});

/** Día civil en Colombia (UTC−5, sin horario de verano). */
export const bogotaDay = (now: Date): string =>
  new Date(now.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);

/**
 * Trae la TRM del día y la guarda. La llama el cron diario; si la fuente falla, la siguiente
 * consulta usa la última tasa guardada.
 */
export async function refreshTrm(
  source: TrmSource,
  store: RateStore,
  now: Date,
): Promise<DailyRate | null> {
  const day = bogotaDay(now);
  const rate = await source.rateOn(day);
  if (rate) await store.save(rate);
  return rate;
}

/**
 * TRM para `day`: la guardada de ese día; si no está, se pide a la fuente y se guarda; si la
 * fuente falla, la última guardada antes de ese día.
 */
export async function trmFor(
  source: TrmSource,
  store: RateStore,
  day: string,
): Promise<DailyRate | null> {
  const stored = await store.latestOnOrBefore("USD", "COP", day);
  if (stored?.day === day) return stored;
  try {
    const fresh = await source.rateOn(day);
    if (fresh) {
      await store.save(fresh);
      return fresh;
    }
  } catch {
    // Sin conexión con datos abiertos: se usa la última conocida.
  }
  return stored;
}
