import type { SqlConnection } from "./sql";

/** Claves conocidas. Los valores se guardan como texto. */
export type PreferenceKey =
  | "onboarding.completedAt"
  | "display.discreet"
  | "sample.ids"
  | "reminders.cardPayments"
  | "movements.lastAccount"
  | "reports.views"
  | "insights.dismissed"
  | "assistant.enabled"
  | "notifications.weekly"
  | "security.allowScreenshots";

export interface Preferences {
  get(key: PreferenceKey): Promise<string | null>;
  set(key: PreferenceKey, value: string): Promise<void>;
  remove(key: PreferenceKey): Promise<void>;
}

export function sqlitePreferences(db: SqlConnection): Preferences {
  return {
    async get(key) {
      const row = await db.get<{ value: string }>(
        "SELECT value FROM preferences WHERE key = ?",
        key,
      );
      return row?.value ?? null;
    },
    async set(key, value) {
      await db.run(
        "INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        key,
        value,
      );
    },
    async remove(key) {
      await db.run("DELETE FROM preferences WHERE key = ?", key);
    },
  };
}
