import type { SqlConnection, SqlValue } from "../data/sql";
import { BackupError } from "./crypto";

/**
 * Tablas que viajan en el respaldo. Los recibos (`attachments`) se quedan por fuera: son fotos en
 * la carpeta privada del teléfono y el respaldo solo lleva datos.
 */
export const BACKUP_TABLES = [
  "accounts",
  "categories",
  "transactions",
  "entries",
  "preferences",
  "tags",
  "transaction_tags",
  "category_rules",
  "recurring",
  "recurring_occurrences",
  "budgets",
  "budget_alerts",
  "goals",
  "exchange_rates",
] as const;

type Row = Record<string, SqlValue>;

export interface Snapshot {
  readonly format: "lukas-snapshot";
  /** `PRAGMA user_version` de la base que lo generó. */
  readonly schemaVersion: number;
  readonly exportedAt: string;
  readonly tables: Partial<Record<(typeof BACKUP_TABLES)[number], Row[]>>;
}

const schemaVersion = async (db: SqlConnection) =>
  (await db.get<{ user_version: number }>("PRAGMA user_version"))?.user_version ?? 0;

export async function exportSnapshot(db: SqlConnection, now: Date): Promise<Snapshot> {
  const tables: Snapshot["tables"] = {};
  for (const name of BACKUP_TABLES) tables[name] = await db.all<Row>(`SELECT * FROM ${name}`);
  return {
    format: "lukas-snapshot",
    schemaVersion: await schemaVersion(db),
    exportedAt: now.toISOString(),
    tables,
  };
}

const isValue = (v: unknown): v is SqlValue =>
  v === null || typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

/** Lee y valida el JSON descifrado. Nada de lo que trae se confía sin revisar. */
export function parseSnapshot(text: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError("invalid_file");
  }
  if (typeof parsed !== "object" || parsed === null) throw new BackupError("invalid_file");
  const s = parsed as Record<string, unknown>;
  if (s.format !== "lukas-snapshot" || !Number.isInteger(s.schemaVersion)) {
    throw new BackupError("invalid_file");
  }
  if (typeof s.tables !== "object" || s.tables === null) throw new BackupError("invalid_file");
  const tables: Snapshot["tables"] = {};
  for (const [name, rows] of Object.entries(s.tables)) {
    if (!(BACKUP_TABLES as readonly string[]).includes(name) || !Array.isArray(rows)) {
      throw new BackupError("invalid_file");
    }
    for (const row of rows) {
      if (typeof row !== "object" || row === null || !Object.values(row).every(isValue)) {
        throw new BackupError("invalid_file");
      }
    }
    tables[name as (typeof BACKUP_TABLES)[number]] = rows as Row[];
  }
  return {
    format: "lukas-snapshot",
    schemaVersion: s.schemaVersion as number,
    exportedAt: String(s.exportedAt ?? ""),
    tables,
  };
}

/**
 * Reemplaza todos los datos por los del respaldo, en una sola transacción: si algo falla, la base
 * queda como estaba. Un respaldo de una versión más nueva de la app se rechaza; uno más viejo se
 * carga con las columnas que tenía (las nuevas toman su valor por defecto).
 */
export async function restoreSnapshot(db: SqlConnection, snapshot: Snapshot): Promise<number> {
  if (snapshot.schemaVersion > (await schemaVersion(db))) throw new BackupError("too_new");
  let restored = 0;
  await db.transaction(async (tx) => {
    // Las llaves foráneas se revisan al confirmar: así el orden de inserción no importa.
    await tx.exec("PRAGMA defer_foreign_keys = ON");
    await tx.exec("DELETE FROM attachments");
    for (const name of [...BACKUP_TABLES].reverse()) await tx.exec(`DELETE FROM ${name}`);
    for (const name of BACKUP_TABLES) {
      const rows = snapshot.tables[name] ?? [];
      if (rows.length === 0) continue;
      const known = new Set(
        (await tx.all<{ name: string }>(`PRAGMA table_info(${name})`)).map((c) => c.name),
      );
      for (const row of rows) {
        // Solo columnas que existen en la tabla: los nombres del archivo nunca llegan al SQL.
        const columns = Object.keys(row).filter((c) => known.has(c));
        if (columns.length === 0) throw new BackupError("invalid_file");
        await tx.run(
          `INSERT INTO ${name} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
          ...columns.map((c) => row[c] ?? null),
        );
        restored++;
      }
    }
    // Un respaldo con referencias rotas no se carga a medias.
    if ((await tx.all("PRAGMA foreign_key_check")).length > 0)
      throw new BackupError("invalid_file");
  });
  return restored;
}
