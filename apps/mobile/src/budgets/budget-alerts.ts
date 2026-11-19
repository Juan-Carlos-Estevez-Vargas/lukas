import type { CivilDate } from "@lukas/domain";
import type { Clock } from "../accounts/accounts";
import type { SqlConnection } from "../data/sql";
import type { ReminderScheduler } from "../reminders/scheduler";
import { type BudgetAlert, checkBudgetAlerts } from "./budgets";

/** Texto del aviso: el porcentaje sí, los montos no (se ve con el teléfono bloqueado). */
export type BudgetAlertTexts = (alert: BudgetAlert) => { title: string; body: string };

/** Revisa los presupuestos y muestra un aviso por cada umbral nuevo. Devuelve cuántos mostró. */
export async function notifyBudgetAlerts(
  db: SqlConnection,
  scheduler: ReminderScheduler,
  today: CivilDate,
  clock: Clock,
  texts: BudgetAlertTexts,
): Promise<number> {
  const alerts = await checkBudgetAlerts(db, today, clock);
  if (!scheduler.available) return 0;
  for (const alert of alerts) await scheduler.present(texts(alert));
  return alerts.length;
}
