import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { Env } from "../../env";
import { drizzleSyncStore, type SyncStore } from "./store";

export interface SyncBackend {
  readonly store: SyncStore;
  /** Libera la conexión al terminar la petición. */
  close(): Promise<void>;
}

/** Almacén del sync del entorno, o `undefined` si no hay base configurada. */
export type SyncFactory = (env: Env) => SyncBackend | undefined;

/**
 * Neon por WebSocket: a diferencia del driver HTTP, permite transacciones interactivas, que
 * `withUser` necesita para fijar usuario y rol. Un pool por petición (los Workers no comparten
 * sockets entre peticiones).
 */
export const neonSyncFactory: SyncFactory = (env) => {
  if (!env.DATABASE_URL) return undefined;
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  return { store: drizzleSyncStore(drizzle({ client: pool })), close: () => pool.end() };
};
