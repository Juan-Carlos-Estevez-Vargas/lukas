import type { SqlConnection, SqlValue } from "./sql";

/** Lo mínimo que se necesita del motor: ejecutar SQL y leer la primera fila. */
export interface RawSql {
  exec(sql: string): Promise<void>;
  get<T>(sql: string, params: SqlValue[]): Promise<T | null>;
  all<T>(sql: string, params: SqlValue[]): Promise<T[]>;
  run(sql: string, params: SqlValue[]): Promise<void>;
}

export class NestedTransactionError extends Error {
  constructor() {
    super("No se admiten transacciones anidadas en la base local");
    this.name = "NestedTransactionError";
  }
}

/**
 * Envuelve una única conexión. Abrir una segunda exigiría repetir la clave de SQLCipher, así que
 * todo pasa por esta y se encola: dos pantallas no pueden intercalar statements dentro de una
 * transacción ajena. Dentro de `transaction` se usa la conexión directa (sin cola) para no
 * bloquearse a sí misma.
 */
export function createConnection(raw: RawSql): SqlConnection {
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };

  const inside: SqlConnection = {
    exec: (sql) => raw.exec(sql),
    get: <T>(sql: string, ...params: SqlValue[]) => raw.get<T>(sql, params),
    all: <T>(sql: string, ...params: SqlValue[]) => raw.all<T>(sql, params),
    run: (sql: string, ...params: SqlValue[]) => raw.run(sql, params),
    transaction: () => Promise.reject(new NestedTransactionError()),
  };

  return {
    exec: (sql) => serial(() => raw.exec(sql)),
    get: <T>(sql: string, ...params: SqlValue[]) => serial(() => raw.get<T>(sql, params)),
    all: <T>(sql: string, ...params: SqlValue[]) => serial(() => raw.all<T>(sql, params)),
    run: (sql: string, ...params: SqlValue[]) => serial(() => raw.run(sql, params)),
    transaction: (work) =>
      serial(async () => {
        await raw.exec("BEGIN IMMEDIATE");
        try {
          await work(inside);
          // Con llaves foráneas diferidas, el COMMIT puede fallar: también se revierte.
          await raw.exec("COMMIT");
        } catch (error) {
          await raw.exec("ROLLBACK");
          throw error;
        }
      }),
  };
}
