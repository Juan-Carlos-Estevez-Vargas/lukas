import type { LocalDatabase } from "./open";

/**
 * En la web no hay Keystore/Keychain ni SQLCipher: guardar las finanzas en el navegador las
 * dejaría en claro. La versión web trabajará contra la API cuando llegue el sync (fase 2).
 */
export class LocalDatabaseUnavailableError extends Error {
  constructor() {
    super("La base local cifrada solo existe en la app de Android e iOS");
    this.name = "LocalDatabaseUnavailableError";
  }
}

export const openDeviceDatabase = (): Promise<LocalDatabase> =>
  Promise.reject(new LocalDatabaseUnavailableError());
