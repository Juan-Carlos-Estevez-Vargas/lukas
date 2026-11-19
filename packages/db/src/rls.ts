import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { TablesRelationalConfig } from "drizzle-orm/relations";

/** Rol sin login al que baja la API en cada petición; solo él pasa por las políticas de RLS. */
export const APP_ROLE = "lukas_app";

/**
 * Ejecuta `fn` como `userId`: abre una transacción, fija `app.user_id` y baja al rol de la app,
 * así que cada consulta pasa por RLS y solo ve los datos de ese usuario y de sus hogares.
 * Ambos ajustes son locales a la transacción: no se filtran a la siguiente petición del pool.
 */
export const withUser = async <
  Q extends PgQueryResultHKT,
  Full extends Record<string, unknown>,
  Schema extends TablesRelationalConfig,
  T,
>(
  db: PgDatabase<Q, Full, Schema>,
  userId: string,
  fn: (tx: PgTransaction<Q, Full, Schema>) => Promise<T>,
): Promise<T> => {
  if (userId.trim() === "") throw new Error("withUser necesita un usuario");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    await tx.execute(sql.raw(`SET LOCAL ROLE ${APP_ROLE}`));
    return fn(tx);
  });
};
