import { openDatabaseAsync, type SQLiteBindValue } from "expo-sqlite";
import type { RawDatabase } from "./open";

/** Adapta expo-sqlite a la interfaz mínima que usan la conexión y las migraciones. */
export async function openExpoDatabase(name: string): Promise<RawDatabase> {
  const db = await openDatabaseAsync(name);
  return {
    exec: (sql) => db.execAsync(sql),
    get: <T>(sql: string, params: SQLiteBindValue[]) => db.getFirstAsync<T>(sql, params),
    all: <T>(sql: string, params: SQLiteBindValue[]) => db.getAllAsync<T>(sql, params),
    run: async (sql: string, params: SQLiteBindValue[]) => {
      await db.runAsync(sql, params);
    },
    close: () => db.closeAsync(),
  };
}
