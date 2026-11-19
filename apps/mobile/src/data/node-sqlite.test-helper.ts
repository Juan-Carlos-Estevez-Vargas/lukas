/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import type { RawDatabase } from "./open";
import type { SqlValue } from "./sql";

/** Base en memoria con `node:sqlite` para probar la lógica sin el dispositivo. */
export function nodeSqlite(): RawDatabase & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  return {
    raw,
    exec: async (sql) => {
      raw.exec(sql);
    },
    get: async <T>(sql: string, params: SqlValue[]) =>
      (raw.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T>(sql: string, params: SqlValue[]) => raw.prepare(sql).all(...params) as T[],
    run: async (sql: string, params: SqlValue[]) => {
      raw.prepare(sql).run(...params);
    },
    close: async () => raw.close(),
  };
}
