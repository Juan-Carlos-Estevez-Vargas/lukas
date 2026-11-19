import type { ReminderScheduler } from "./scheduler";

/** En la web no hay base local ni tarjetas que recordar. */
export const notificationScheduler: ReminderScheduler = {
  available: false,
  ensurePermission: async () => false,
  pending: async () => [],
  cancel: async () => undefined,
  schedule: async () => undefined,
};
