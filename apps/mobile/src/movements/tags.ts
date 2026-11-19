import { normalizeTag } from "@lukas/domain";
import type { Clock } from "../accounts/accounts";
import type { SqlConnection } from "../data/sql";

/** Asocia etiquetas a una transacción, creando las que no existan. Debe correr en una transacción. */
export async function tagTransaction(
  tx: SqlConnection,
  transactionId: string,
  names: readonly string[],
  clock: Clock,
): Promise<void> {
  for (const raw of names) {
    const name = normalizeTag(raw);
    if (!name) continue;
    let tag = await tx.get<{ id: string }>("SELECT id FROM tags WHERE name = ?", name);
    if (!tag) {
      tag = { id: clock.newId() };
      await tx.run(
        "INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)",
        tag.id,
        name,
        clock.now().toISOString(),
      );
    }
    await tx.run(
      "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)",
      transactionId,
      tag.id,
    );
  }
}

/** Etiquetas usadas, las más recientes y frecuentes primero, para tocarlas en vez de escribirlas. */
export async function recentTags(db: SqlConnection, limit = 8): Promise<string[]> {
  const rows = await db.all<{ name: string }>(
    `SELECT g.name FROM tags g
     JOIN transaction_tags tt ON tt.tag_id = g.id
     JOIN transactions t ON t.id = tt.transaction_id AND t.deleted_at IS NULL
     GROUP BY g.id
     ORDER BY max(t.occurred_at) DESC, count(*) DESC
     LIMIT ?`,
    limit,
  );
  return rows.map((r) => r.name);
}

export async function tagsOf(db: SqlConnection, transactionId: string): Promise<string[]> {
  const rows = await db.all<{ name: string }>(
    `SELECT g.name FROM tags g JOIN transaction_tags tt ON tt.tag_id = g.id
     WHERE tt.transaction_id = ? ORDER BY g.name`,
    transactionId,
  );
  return rows.map((r) => r.name);
}
