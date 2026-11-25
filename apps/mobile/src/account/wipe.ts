import { migrate } from "../data/migrations";
import { LOCAL_MIGRATIONS } from "../data/schema";
import type { SqlConnection } from "../data/sql";

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * Deja la base local como recién instalada: borra las fotos de recibos, elimina todas las tablas
 * y vuelve a correr las migraciones (con las categorías de sistema). Se usa después de borrar la
 * cuenta, para que en el teléfono no quede nada de la persona.
 */
export async function wipeLocalData(
  db: SqlConnection,
  removeFile: (fileName: string) => Promise<void>,
): Promise<void> {
  const files = await db.all<{ file_name: string }>("SELECT file_name FROM attachments");
  for (const { file_name } of files) await removeFile(file_name).catch(() => undefined);

  const objects = await db.all<{ type: string; name: string }>(
    `SELECT type, name FROM sqlite_master
      WHERE type IN ('trigger', 'view', 'table') AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type WHEN 'trigger' THEN 0 WHEN 'view' THEN 1 ELSE 2 END`,
  );
  await db.exec("PRAGMA foreign_keys = OFF");
  try {
    for (const { type, name } of objects) {
      const kind = type === "trigger" ? "TRIGGER" : type === "view" ? "VIEW" : "TABLE";
      await db.exec(`DROP ${kind} IF EXISTS ${quoted(name)}`);
    }
    await db.exec("PRAGMA user_version = 0");
  } finally {
    await db.exec("PRAGMA foreign_keys = ON");
  }
  await migrate(db, LOCAL_MIGRATIONS);
}
