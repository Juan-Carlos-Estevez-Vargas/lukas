import { addDays } from "@lukas/domain";
import { civilDate } from "../accounts/credit-card";
import type { SqlConnection } from "../data/sql";
import { REMINDER_HOUR } from "../reminders/card-reminders";
import type { ReminderScheduler } from "../reminders/scheduler";
import { civilKey, listRecurring, type Recurring, upcomingOf } from "./recurring";

export const RECURRING_REMINDER_PREFIX = "recurring:";

/** Textos del aviso, sin montos: la notificación se ve con el teléfono bloqueado. */
export type RecurringTexts = (r: Recurring) => { title: string; body: string };

/**
 * Deja programado un aviso a las 9 a. m. del día de la siguiente ocurrencia de cada recurrente
 * con aviso. Idempotente: se llama al abrir la app y después de cada cambio.
 */
export async function syncRecurringReminders(
  db: SqlConnection,
  scheduler: ReminderScheduler,
  now: Date,
  texts: RecurringTexts,
): Promise<number> {
  if (!scheduler.available) return 0;
  for (const id of await scheduler.pending(RECURRING_REMINDER_PREFIX)) await scheduler.cancel(id);
  const today = civilDate(now);
  // Si ya pasó la hora del aviso de hoy, el siguiente posible es mañana.
  const from = now.getHours() >= REMINDER_HOUR ? addDays(today, 1) : today;
  let scheduled = 0;
  for (const r of await listRecurring(db)) {
    if (!r.remind) continue;
    const at = upcomingOf(r, from);
    if (!at) continue;
    await scheduler.schedule({
      id: `${RECURRING_REMINDER_PREFIX}${r.id}:${civilKey(at)}`,
      at,
      hour: REMINDER_HOUR,
      ...texts(r),
    });
    scheduled++;
  }
  return scheduled;
}
