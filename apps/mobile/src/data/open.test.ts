/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { KeyStore } from "./key";
import {
  DATABASE_NAME,
  MEMORY_DATABASE,
  type OpenDeps,
  openLocalDatabase,
  openMemoryDatabase,
  type RawDatabase,
  SqlCipherMissingError,
  WrongDatabaseKeyError,
} from "./open";
import { LOCAL_MIGRATIONS } from "./schema";
import type { SqlValue } from "./sql";

/**
 * Emula SQLCipher sobre `node:sqlite`: cada "archivo" recuerda la clave con que se creó y la
 * primera lectura falla si se abre con otra. El cifrado real se prueba en el dispositivo.
 */
function fakeDevice(options: { cipher?: boolean } = {}) {
  const files = new Map<string, { db: DatabaseSync; key?: string | undefined }>();
  let stored: string | null = null;
  let nextByte = 1;
  const keyStore: KeyStore = {
    read: async () => stored,
    write: async (v) => {
      stored = v;
    },
  };

  const open = async (name: string): Promise<RawDatabase> => {
    let file = files.get(name);
    if (!file) {
      file = { db: new DatabaseSync(":memory:") };
      files.set(name, file);
    }
    const f = file;
    let provided: string | undefined;
    return {
      exec: async (sql) => {
        const m = /^PRAGMA key = "x'([0-9a-f]+)'"$/.exec(sql);
        if (m) provided = m[1];
        else f.db.exec(sql);
      },
      get: async <T>(sql: string, params: SqlValue[]) => {
        if (sql === "PRAGMA cipher_version") {
          return (options.cipher === false ? null : { cipher_version: "4.6.1" }) as T | null;
        }
        if (sql.includes("sqlite_master") && f.key !== provided) {
          if (f.key === undefined) f.key = provided;
          else throw new Error("file is not a database");
        }
        return (f.db.prepare(sql).get(...params) as T | undefined) ?? null;
      },
      all: async <T>(sql: string, params: SqlValue[]) => f.db.prepare(sql).all(...params) as T[],
      run: async (sql: string, params: SqlValue[]) => {
        f.db.prepare(sql).run(...params);
      },
      close: async () => undefined,
    };
  };

  const deps: OpenDeps = {
    keyStore,
    random: async (n) => new Uint8Array(n).fill(nextByte++),
    open,
    remove: async (name) => {
      files.delete(name);
    },
    migrations: LOCAL_MIGRATIONS,
  };
  return {
    deps,
    files,
    setStored: (v: string | null) => {
      stored = v;
    },
  };
}

describe("abrir la base local", () => {
  it("crea la clave, abre la base cifrada y la migra", async () => {
    const device = fakeDevice();
    const local = await openLocalDatabase(device.deps);
    expect(local.migrated).toEqual({ from: 0, to: LOCAL_MIGRATIONS.length });
    expect(await local.db.get("PRAGMA foreign_keys")).toEqual({ foreign_keys: 1 });
    expect(device.files.get(DATABASE_NAME)?.key).toMatch(/^[0-9a-f]{64}$/);
    await local.close();
  });

  it("vuelve a abrir con la misma clave sin migrar de nuevo", async () => {
    const device = fakeDevice();
    await openLocalDatabase(device.deps);
    const again = await openLocalDatabase(device.deps);
    expect(again.migrated.from).toBe(LOCAL_MIGRATIONS.length);
  });

  it("no abre la base si la clave guardada no corresponde, y no la borra", async () => {
    const device = fakeDevice();
    await openLocalDatabase(device.deps);
    device.setStored("ff".repeat(32));
    await expect(openLocalDatabase(device.deps)).rejects.toBeInstanceOf(WrongDatabaseKeyError);
    expect(device.files.has(DATABASE_NAME)).toBe(true);
  });

  it("si la clave se perdió, reemplaza el archivo ilegible por uno nuevo", async () => {
    const device = fakeDevice();
    await openLocalDatabase(device.deps);
    device.setStored(null);
    const local = await openLocalDatabase(device.deps);
    expect(local.migrated.from).toBe(0);
  });

  it("se niega a abrir la base sin SQLCipher", async () => {
    const device = fakeDevice({ cipher: false });
    await expect(openLocalDatabase(device.deps)).rejects.toBeInstanceOf(SqlCipherMissingError);
  });

  it("en la web abre una base en memoria, sin clave, migrada y no persistente", async () => {
    const device = fakeDevice();
    const local = await openMemoryDatabase(device.deps.open, LOCAL_MIGRATIONS);
    expect(local.persistent).toBe(false);
    expect(local.migrated).toEqual({ from: 0, to: LOCAL_MIGRATIONS.length });
    expect(await local.db.get("PRAGMA foreign_keys")).toEqual({ foreign_keys: 1 });
    expect([...device.files.keys()]).toEqual([MEMORY_DATABASE]);
    expect(await device.deps.keyStore.read()).toBeNull();
    await local.close();
  });
});
