import { DomainError } from "../errors";
import { Money } from "../money";
import { err, ok, type Result } from "../result";
import { addMonths, type CivilDate, dayIn } from "./credit-card";
import { addDays } from "./recurrence";

export type BudgetPeriod = "weekly" | "monthly" | "yearly";
export const BUDGET_PERIODS: readonly BudgetPeriod[] = ["weekly", "monthly", "yearly"];

/** Ventana de un periodo: de `start` a `end`, ambos inclusive. */
export interface PeriodWindow {
  readonly start: CivilDate;
  readonly end: CivilDate;
}

const weekday = (d: CivilDate): number =>
  new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();

/** Periodo que contiene `day`. Las semanas empiezan el lunes. */
export function periodWindow(period: BudgetPeriod, day: CivilDate): PeriodWindow {
  switch (period) {
    case "weekly": {
      const start = addDays(day, -((weekday(day) + 6) % 7));
      return { start, end: addDays(start, 6) };
    }
    case "monthly":
      return { start: { ...day, day: 1 }, end: dayIn(day.year, day.month, 31) };
    case "yearly":
      return {
        start: { year: day.year, month: 1, day: 1 },
        end: { year: day.year, month: 12, day: 31 },
      };
  }
}

/** El periodo anterior (`-1`) o siguiente (`1`) a `window`. */
export function shiftWindow(
  period: BudgetPeriod,
  window: PeriodWindow,
  delta: number,
): PeriodWindow {
  if (period === "weekly") return periodWindow(period, addDays(window.start, delta * 7));
  const months = period === "monthly" ? delta : delta * 12;
  const [y, m] = addMonths(window.start.year, window.start.month, months);
  return periodWindow(period, { year: y, month: m, day: 1 });
}

/** Cuántos periodos completos hay entre el que contiene `from` y el que contiene `to`. */
export function periodsBetween(period: BudgetPeriod, from: CivilDate, to: CivilDate): number {
  switch (period) {
    case "weekly": {
      const a = periodWindow(period, from).start;
      const b = periodWindow(period, to).start;
      return Math.round(
        (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) /
          (7 * 86_400_000),
      );
    }
    case "monthly":
      return (to.year - from.year) * 12 + (to.month - from.month);
    case "yearly":
      return to.year - from.year;
  }
}

export type BudgetLevel = "ok" | "warning" | "over";

/** Umbrales de aviso, en porcentaje del presupuesto disponible. */
export const WARNING_PERCENT = 80n;

export function budgetLevel(spent: Money, available: Money): BudgetLevel {
  const s = spent.amountMinor;
  const a = available.amountMinor;
  if (a <= 0n) return s > 0n || a < 0n ? "over" : "ok";
  if (s >= a) return "over";
  if (s * 100n >= a * WARNING_PERCENT) return "warning";
  return "ok";
}

/** Porcentaje gastado, redondeado hacia abajo (para mostrar y para los avisos, nunca para montos). */
export function percentUsed(spent: Money, available: Money): number {
  if (available.amountMinor <= 0n) return spent.amountMinor > 0n ? 100 : 0;
  return Number((spent.amountMinor * 100n) / available.amountMinor);
}

export interface BudgetFigures {
  readonly limit: Money;
  /** Gasto neto del periodo actual (los reembolsos restan). */
  readonly spentNow: Money;
  /**
   * Para sobres: periodos completos desde que empezó el presupuesto y el gasto total en ellos.
   * Lo que sobra (o falta) pasa al periodo actual.
   */
  readonly envelope?: { readonly periodsBefore: number; readonly spentBefore: Money } | null;
}

export interface BudgetStatus {
  readonly limit: Money;
  /** Lo que viene de periodos anteriores (sobres); cero si no acumula. */
  readonly carried: Money;
  readonly available: Money;
  readonly spent: Money;
  readonly remaining: Money;
  readonly percent: number;
  readonly level: BudgetLevel;
}

export function budgetStatus(f: BudgetFigures): BudgetStatus {
  const carried = f.envelope
    ? f.limit.multiply(String(f.envelope.periodsBefore)).subtract(f.envelope.spentBefore)
    : Money.zero(f.limit.currencyCode);
  const available = f.limit.add(carried);
  return {
    limit: f.limit,
    carried,
    available,
    spent: f.spentNow,
    remaining: available.subtract(f.spentNow),
    percent: percentUsed(f.spentNow, available),
    level: budgetLevel(f.spentNow, available),
  };
}

export function validateBudgetAmount(limit: Money): Result<Money, DomainError> {
  return limit.isZero() || limit.isNegative()
    ? err(new DomainError("invalid_amount", "El presupuesto debe ser mayor que cero"))
    : ok(limit);
}

export type BudgetGroup = "needs" | "wants" | "savings";
export const BUDGET_GROUPS: readonly BudgetGroup[] = ["needs", "wants", "savings"];

/** Reparto 50/30/20 del ingreso: necesidades, gustos y ahorro. Suma exactamente el ingreso. */
export function split503020(income: Money): Record<BudgetGroup, Money> {
  const base = income.isNegative() ? Money.zero(income.currencyCode) : income;
  const [needs, wants, savings] = base.allocate([50n, 30n, 20n]);
  if (!needs || !wants || !savings) throw new Error("allocate devolvió menos partes");
  return { needs, wants, savings };
}

export type AlertLevel = Exclude<BudgetLevel, "ok">;

/**
 * Avisos que faltan por dar en este periodo. Si el gasto salta directo del 70 % al 110 %, se
 * anotan los dos pero solo se avisa el más alto (el último de la lista).
 */
export function pendingAlerts(level: BudgetLevel, sent: readonly AlertLevel[]): AlertLevel[] {
  const reached: AlertLevel[] =
    level === "over" ? ["warning", "over"] : level === "warning" ? ["warning"] : [];
  return reached.filter((l) => !sent.includes(l));
}
