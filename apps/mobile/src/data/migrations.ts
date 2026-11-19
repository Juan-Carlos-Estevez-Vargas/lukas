import type { SqlConnection } from "./sql";

export interface Migration {
  /** Número consecutivo desde 1. Se guarda en `PRAGMA user_version`. */
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export interface MigrationResult {
  readonly from: number;
  readonly to: number;
}

/** La base del dispositivo es de una versión de la app más nueva que esta. */
export class DatabaseTooNewError extends Error {
  constructor(
    readonly current: number,
    readonly supported: number,
  ) {
    super(`La base local está en la versión ${current} y esta app solo conoce hasta ${supported}`);
    this.name = "DatabaseTooNewError";
  }
}

/** Revisa que las migraciones vayan 1, 2, 3… sin huecos ni repetidas. */
export function assertSequential(migrations: readonly Migration[]): void {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(`Migración fuera de orden: se esperaba la ${i + 1} y llegó la ${m.version}`);
    }
  });
}

/**
 * Aplica las migraciones pendientes. Cada una corre en su propia transacción junto con el cambio
 * de `user_version`, así que un fallo deja la base en la última versión completa.
 * Las migraciones publicadas nunca se editan: un cambio de esquema es una migración nueva.
 */
export async function migrate(
  db: SqlConnection,
  migrations: readonly Migration[],
): Promise<MigrationResult> {
  assertSequential(migrations);
  const row = await db.get<{ user_version: number }>("PRAGMA user_version");
  const from = row?.user_version ?? 0;
  const latest = migrations.length;
  if (from > latest) throw new DatabaseTooNewError(from, latest);

  for (const m of migrations.slice(from)) {
    await db.transaction(async (tx) => {
      await tx.exec(m.sql);
      // PRAGMA no acepta parámetros; `version` es un entero de este mismo archivo.
      await tx.exec(`PRAGMA user_version = ${Math.trunc(m.version)}`);
    });
  }
  return { from, to: latest };
}
