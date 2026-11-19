import type { CivilDate } from "@lukas/domain";

/** Notificación local programada en el teléfono. Nada sale del dispositivo. */
export interface LocalReminder {
  readonly id: string;
  readonly at: CivilDate;
  /** Hora local, 0–23. */
  readonly hour: number;
  readonly title: string;
  readonly body: string;
}

/** Puerto de notificaciones locales; la app usa expo-notifications y la web no tiene. */
export interface ReminderScheduler {
  readonly available: boolean;
  /** Pide permiso si hace falta. `false` si la persona lo negó. */
  ensurePermission(): Promise<boolean>;
  /** Ids de recordatorios pendientes que empiezan por `prefix`. */
  pending(prefix: string): Promise<string[]>;
  cancel(id: string): Promise<void>;
  schedule(reminder: LocalReminder): Promise<void>;
}
