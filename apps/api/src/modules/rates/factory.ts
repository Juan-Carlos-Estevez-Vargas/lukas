import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { Env } from "../../env";
import {
  datosGovTrm,
  drizzleRateStore,
  memoryRateStore,
  type RateStore,
  type TrmSource,
} from "./trm";

export interface Rates {
  readonly source: TrmSource;
  readonly store: RateStore;
}

/** Fuente y almacenamiento de tasas del entorno. */
export type RatesFactory = (env: Env) => Rates;

const cache = new WeakMap<Env, Rates>();

/** Por defecto: datos abiertos + Neon; sin base configurada, memoria del isolate. */
export const defaultRatesFactory: RatesFactory = (env) => {
  const cached = cache.get(env);
  if (cached) return cached;
  const rates: Rates = {
    source: datosGovTrm(),
    store: env.DATABASE_URL
      ? drizzleRateStore(drizzle({ client: neon(env.DATABASE_URL) }))
      : memoryRateStore(),
  };
  cache.set(env, rates);
  return rates;
};
