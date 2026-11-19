import { DomainError } from "../errors";
import { Money } from "../money";
import { err, ok, type Result } from "../result";
import { divideRounded } from "../rounding";
import { type CivilDate, compareCivil } from "./credit-card";

/**
 * Cuántos aportes mensuales caben de hoy a la fecha meta, contando el de hoy: uno por mes el
 * mismo día. Si la meta es hoy, uno; si ya pasó, cero.
 */
export function monthlyContributionsLeft(today: CivilDate, target: CivilDate): number {
  if (compareCivil(target, today) < 0) return 0;
  const months = (target.year - today.year) * 12 + (target.month - today.month);
  return months + (target.day >= today.day ? 1 : 0);
}

export interface GoalProgress {
  readonly saved: Money;
  readonly remaining: Money;
  /** 0 a 100, redondeado hacia abajo. */
  readonly percent: number;
  readonly done: boolean;
  readonly contributionsLeft: number;
  /** Cuánto apartar por mes para llegar a tiempo, en pesos enteros hacia arriba. `null` si ya se logró. */
  readonly monthly: Money | null;
  /** La fecha ya pasó sin completar la meta. */
  readonly overdue: boolean;
}

/** Unidad mayor de la moneda en unidades menores (pesos, dólares) para redondear el aporte. */
const MAJOR_UNIT = 100n;

export function goalProgress(
  target: Money,
  saved: Money,
  today: CivilDate,
  targetDate: CivilDate,
): GoalProgress {
  const kept = saved.isNegative() ? Money.zero(saved.currencyCode) : saved;
  const missing = target.subtract(kept);
  const remaining = missing.isNegative() ? Money.zero(target.currencyCode) : missing;
  const done = remaining.isZero();
  const percent = done ? 100 : Number((kept.amountMinor * 100n) / target.amountMinor);
  const contributionsLeft = monthlyContributionsLeft(today, targetDate);
  const overdue = !done && contributionsLeft === 0;
  let monthly: Money | null = null;
  if (!done) {
    const perMonth = divideRounded(
      remaining.amountMinor,
      BigInt(Math.max(contributionsLeft, 1)),
      "ceil",
    );
    const whole = divideRounded(perMonth, MAJOR_UNIT, "ceil") * MAJOR_UNIT;
    monthly = Money.ofMinor(whole, target.currencyCode);
  }
  return { saved: kept, remaining, percent, done, contributionsLeft, monthly, overdue };
}

export function validateGoal(input: {
  readonly name: string;
  readonly target: Money;
  readonly targetDate: CivilDate;
  readonly today: CivilDate;
}): Result<string, DomainError> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) return err(new DomainError("goal_name_required", "Ponle un nombre a la meta"));
  if (input.target.isZero() || input.target.isNegative()) {
    return err(new DomainError("invalid_amount", "La meta debe ser mayor que cero"));
  }
  if (compareCivil(input.targetDate, input.today) < 0) {
    return err(new DomainError("goal_date_past", "La fecha de la meta ya pasó"));
  }
  return ok(name);
}
