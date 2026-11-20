import { getRandomBytesAsync } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { deleteDatabaseAsync } from "expo-sqlite";
import { openExpoDatabase } from "./expo-raw";
import { type LocalDatabase, type OpenDeps, openLocalDatabase } from "./open";
import { LOCAL_MIGRATIONS } from "./schema";

const KEY_NAME = "lukas.db.key";

/** Solo con el dispositivo desbloqueado y sin salir de él (no entra en copias de seguridad). */
const secure: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const deps: OpenDeps = {
  keyStore: {
    read: () => SecureStore.getItemAsync(KEY_NAME, secure),
    write: (value) => SecureStore.setItemAsync(KEY_NAME, value, secure),
  },
  random: getRandomBytesAsync,
  open: openExpoDatabase,
  remove: (name) => deleteDatabaseAsync(name),
  migrations: LOCAL_MIGRATIONS,
};

/** Base local cifrada con SQLCipher (expo-sqlite con `useSQLCipher` en app.json). */
export const openDeviceDatabase = (): Promise<LocalDatabase> => openLocalDatabase(deps);
