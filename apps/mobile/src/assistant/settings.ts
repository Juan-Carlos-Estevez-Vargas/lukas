import { sqlitePreferences } from "../data/preferences";
import type { SqlConnection } from "../data/sql";

/**
 * El asistente arranca apagado: usarlo manda preguntas y cifras resumidas a un proveedor de IA,
 * así que la persona lo enciende sabiendo qué implica y lo apaga cuando quiera.
 */
export async function assistantEnabled(db: SqlConnection): Promise<boolean> {
  return (await sqlitePreferences(db).get("assistant.enabled")) === "1";
}

export async function setAssistantEnabled(db: SqlConnection, on: boolean): Promise<void> {
  if (on) await sqlitePreferences(db).set("assistant.enabled", "1");
  else await sqlitePreferences(db).remove("assistant.enabled");
}
