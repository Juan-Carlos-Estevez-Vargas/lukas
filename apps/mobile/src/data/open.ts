import { createConnection, type RawSql } from "./connection";
import { getOrCreateDatabaseKey, type KeyStore, keyPragma, type RandomBytes } from "./key";
import { type Migration, type MigrationResult, migrate } from "./migrations";
import type { SqlConnection } from "./sql";

export const DATABASE_NAME = "lukas.db";

export interface RawDatabase extends RawSql {
  close(): Promise<void>;
}

/** Lo que cambia entre la app y las pruebas. */
export interface OpenDeps {
  keyStore: KeyStore;
  random: RandomBytes;
  open(name: string): Promise<RawDatabase>;
  remove(name: string): Promise<void>;
  migrations: readonly Migration[];
}

export interface LocalDatabase {
  readonly db: SqlConnection;
  readonly migrated: MigrationResult;
  close(): Promise<void>;
}

/** El binario se compiló sin SQLCipher: la base quedaría en claro, así que no se abre. */
export class SqlCipherMissingError extends Error {
  constructor() {
    super("SQLCipher no está disponible: la base local no se abre sin cifrado");
    this.name = "SqlCipherMissingError";
  }
}

/** La clave guardada no abre la base existente. */
export class WrongDatabaseKeyError extends Error {
  constructor() {
    super("La clave guardada no abre la base local");
    this.name = "WrongDatabaseKeyError";
  }
}

async function unlock(raw: RawDatabase, keyHex: string): Promise<boolean> {
  // La clave tiene que ser lo primero que se ejecuta en la conexión.
  await raw.exec(keyPragma(keyHex));
  const cipher = await raw.get<{ cipher_version: string }>("PRAGMA cipher_version", []);
  if (!cipher?.cipher_version) throw new SqlCipherMissingError();
  try {
    // Con una clave equivocada SQLCipher no puede leer el encabezado y falla aquí.
    await raw.get("SELECT count(*) AS n FROM sqlite_master", []);
    return true;
  } catch {
    return false;
  }
}

/**
 * Abre la base cifrada del dispositivo y la deja migrada.
 *
 * Si la clave se acaba de crear y ya había un archivo (p. ej. el Keystore se borró al restaurar el
 * teléfono), ese archivo es ilegible para siempre: se elimina y se crea uno nuevo. Si la clave ya
 * existía y no abre la base, se falla sin tocar nada para no perder datos.
 */
export async function openLocalDatabase(deps: OpenDeps): Promise<LocalDatabase> {
  const key = await getOrCreateDatabaseKey(deps.keyStore, deps.random);
  let raw = await deps.open(DATABASE_NAME);
  if (!(await unlock(raw, key.hex))) {
    await raw.close();
    if (!key.created) throw new WrongDatabaseKeyError();
    await deps.remove(DATABASE_NAME);
    raw = await deps.open(DATABASE_NAME);
    if (!(await unlock(raw, key.hex))) {
      await raw.close();
      throw new WrongDatabaseKeyError();
    }
  }

  await raw.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  const db = createConnection(raw);
  const migrated = await migrate(db, deps.migrations);
  return { db, migrated, close: () => raw.close() };
}
