import { getRandomBytesAsync } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteBindValue } from "expo-sqlite";
import { type LocalDatabase, type OpenDeps, openLocalDatabase, type RawDatabase } from "./open";
import { LOCAL_MIGRATIONS } from "./schema";

const KEY_NAME = "lukas.db.key";

/** Solo con el dispositivo desbloqueado y sin salir de él (no entra en copias de seguridad). */
const secure: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function open(name: string): Promise<RawDatabase> {
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

const deps: OpenDeps = {
  keyStore: {
    read: () => SecureStore.getItemAsync(KEY_NAME, secure),
    write: (value) => SecureStore.setItemAsync(KEY_NAME, value, secure),
  },
  random: getRandomBytesAsync,
  open,
  remove: (name) => deleteDatabaseAsync(name),
  migrations: LOCAL_MIGRATIONS,
};

/** Base local cifrada con SQLCipher (expo-sqlite con `useSQLCipher` en app.json). */
export const openDeviceDatabase = (): Promise<LocalDatabase> => openLocalDatabase(deps);
