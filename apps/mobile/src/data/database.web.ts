import { openExpoDatabase } from "./expo-raw";
import { type LocalDatabase, openMemoryDatabase } from "./open";
import { LOCAL_MIGRATIONS } from "./schema";

/**
 * En la web no hay Keystore/Keychain ni SQLCipher: guardar las finanzas en el navegador las
 * dejaría en claro. Por eso la base vive solo en memoria (wa-sqlite) y se llena con el sync al
 * entrar; al cerrar la pestaña no queda nada en el equipo.
 */
export const openDeviceDatabase = (): Promise<LocalDatabase> =>
  openMemoryDatabase(openExpoDatabase, LOCAL_MIGRATIONS);
