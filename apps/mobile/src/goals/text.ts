import type { GoalProgress, Money } from "@lukas/domain";
import type { Translate } from "../i18n/translator";

/** La línea que responde "¿cuánto aparto?": cumplida, vencida o el aporte mensual. */
export function goalLine(p: GoalProgress, t: Translate, money: (m: Money) => string): string {
  if (p.done) return t("goals.done");
  if (p.overdue) return t("goals.overdue", { amount: money(p.remaining) });
  const amount = money(p.monthly ?? p.remaining);
  return t(p.contributionsLeft === 1 ? "goals.monthlyOne" : "goals.monthly", { amount });
}
