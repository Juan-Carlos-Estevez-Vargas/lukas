import { type Account, type CivilDate, daysBetween, paymentReminderDates } from "@lukas/domain";
import { cardSummary, civilDate } from "../accounts/credit-card";
import { sqliteAccounts } from "../data/ledger-sqlite";
import { sqlitePreferences } from "../data/preferences";
import type { SqlConnection } from "../data/sql";
import type { ReminderScheduler } from "./scheduler";

export const CARD_REMINDER_PREFIX = "card-due:";
export const REMINDER_HOUR = 9;

/** Textos del aviso. No llevan montos: la notificación se ve con el teléfono bloqueado. */
export type ReminderTexts = (card: Account, daysLeft: number) => { title: string; body: string };

const key = (d: CivilDate) =>
  `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

export async function cardRemindersEnabled(db: SqlConnection): Promise<boolean> {
  return (await sqlitePreferences(db).get("reminders.cardPayments")) === "1";
}

export async function setCardRemindersEnabled(db: SqlConnection, on: boolean): Promise<void> {
  await sqlitePreferences(db).set("reminders.cardPayments", on ? "1" : "0");
}

/**
 * Deja programados exactamente los avisos de pago que tocan: 3 días antes y el mismo día de la
 * fecha límite del extracto pendiente (o del siguiente, si hay deuda nueva). Es idempotente:
 * se puede llamar al abrir la app y después de cada cambio.
 */
export async function syncCardReminders(
  db: SqlConnection,
  scheduler: ReminderScheduler,
  now: Date,
  texts: ReminderTexts,
): Promise<number> {
  if (!scheduler.available) return 0;
  for (const id of await scheduler.pending(CARD_REMINDER_PREFIX)) await scheduler.cancel(id);
  if (!(await cardRemindersEnabled(db))) return 0;

  const today = civilDate(now);
  const cards = (await sqliteAccounts(db).list()).filter((a) => a.type === "credit_card");
  let scheduled = 0;
  for (const card of cards) {
    const res = await cardSummary(db, card, today);
    if (!res.ok) continue;
    const s = res.value;
    const due = !s.amountDue.isZero() ? s.lastStatement.due : !s.debt.isZero() ? s.cycle.due : null;
    if (!due) continue;
    for (const at of paymentReminderDates(due, today)) {
      const fireAt = new Date(at.year, at.month - 1, at.day, REMINDER_HOUR);
      if (fireAt.getTime() <= now.getTime()) continue;
      await scheduler.schedule({
        id: `${CARD_REMINDER_PREFIX}${card.id}:${key(at)}`,
        at,
        hour: REMINDER_HOUR,
        ...texts(card, daysBetween(at, due)),
      });
      scheduled++;
    }
  }
  return scheduled;
}
