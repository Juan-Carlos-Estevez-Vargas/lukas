/**
 * Valor que acepta la base como parámetro. expo-sqlite no enlaza `bigint`: los montos (unidades
 * menores) viajan como `number` entero y los repositorios validan `Number.isSafeInteger`
 * (hasta 9 × 10^15, de sobra para pesos y dólares).
 */
export type SqlValue = string | number | null;

/**
 * Puerto mínimo sobre la base local. La app usa expo-sqlite con SQLCipher; las pruebas usan
 * `node:sqlite`. Así la lógica de migraciones y, luego, los repositorios no dependen del motor.
 */
export interface SqlConnection {
  /** Ejecuta uno o varios statements sin parámetros (DDL, PRAGMA). */
  exec(sql: string): Promise<void>;
  /** Primera fila del resultado, o `null` si no hay filas. */
  get<T>(sql: string, ...params: SqlValue[]): Promise<T | null>;
  /** Ejecuta `work` en una transacción: si lanza, se revierte todo. */
  transaction(work: (tx: SqlConnection) => Promise<void>): Promise<void>;
}
