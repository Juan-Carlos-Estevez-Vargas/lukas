import { DomainError } from "../errors";
import { Money } from "../money";
import { err, ok, type Result } from "../result";
import { divideRounded } from "../rounding";
import type { Account } from "./account";

/** Fecha de calendario sin hora ni zona: el corte y el pago son días, no instantes. */
export interface CivilDate {
  readonly year: number;
  /** 1 a 12. */
  readonly month: number;
  readonly day: number;
}

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Día del mes ajustado: el corte "31" cae el 30 en abril y el 28 o 29 en febrero. */
export function dayIn(year: number, month: number, day: number): CivilDate {
  return { year, month, day: Math.min(day, daysInMonth(year, month)) };
}

export function addMonths(year: number, month: number, delta: number): [number, number] {
  const index = year * 12 + (month - 1) + delta;
  return [Math.floor(index / 12), (index % 12) + 1];
}

export function compareCivil(a: CivilDate, b: CivilDate): -1 | 0 | 1 {
  const ka = a.year * 10_000 + a.month * 100 + a.day;
  const kb = b.year * 10_000 + b.month * 100 + b.day;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

export function nextDay(d: CivilDate): CivilDate {
  if (d.day < daysInMonth(d.year, d.month)) return { ...d, day: d.day + 1 };
  const [year, month] = addMonths(d.year, d.month, 1);
  return { year, month, day: 1 };
}

/** Diferencia en días de calendario (b − a). */
export function daysBetween(a: CivilDate, b: CivilDate): number {
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}

/** Configuración de facturación de una tarjeta. */
export interface BillingDays {
  readonly closingDay: number;
  readonly dueDay: number;
}

/** Un periodo de facturación: compras de `opens` a `closes` (inclusive), se pagan hasta `due`. */
export interface StatementCycle {
  readonly opens: CivilDate;
  readonly closes: CivilDate;
  readonly due: CivilDate;
}

export function billingDaysOf(account: Account): Result<BillingDays, DomainError> {
  if (account.type !== "credit_card") {
    return err(new DomainError("not_a_credit_card", "La cuenta no es una tarjeta de crédito"));
  }
  if (account.closingDay === null || account.dueDay === null) {
    return err(
      new DomainError("billing_days_missing", "Configura el día de corte y el día de pago"),
    );
  }
  return ok({ closingDay: account.closingDay, dueDay: account.dueDay });
}

/** El ciclo que cierra en el mes indicado. */
function cycleClosingIn(days: BillingDays, year: number, month: number): StatementCycle {
  const closes = dayIn(year, month, days.closingDay);
  const [py, pm] = addMonths(year, month, -1);
  const opens = nextDay(dayIn(py, pm, days.closingDay));
  // Si el día de pago es posterior al de corte, se paga el mismo mes; si no, el siguiente.
  const [dy, dm] = days.dueDay > days.closingDay ? [year, month] : addMonths(year, month, 1);
  return { opens, closes, due: dayIn(dy, dm, days.dueDay) };
}

/** Ciclo abierto: el que contiene `today` y aún no ha cortado. */
export function currentCycle(days: BillingDays, today: CivilDate): StatementCycle {
  const thisMonth = cycleClosingIn(days, today.year, today.month);
  if (compareCivil(today, thisMonth.closes) <= 0) return thisMonth;
  const [y, m] = addMonths(today.year, today.month, 1);
  return cycleClosingIn(days, y, m);
}

/** Último ciclo cerrado: el extracto que toca pagar. */
export function lastClosedCycle(days: BillingDays, today: CivilDate): StatementCycle {
  const open = currentCycle(days, today);
  const [y, m] = addMonths(open.closes.year, open.closes.month, -1);
  return cycleClosingIn(days, y, m);
}

/** Regla para estimar el pago mínimo: un porcentaje (en puntos básicos) del saldo a pagar. */
export interface MinimumPaymentRule {
  readonly basisPoints: bigint;
}

/**
 * Cada banco calcula el mínimo a su manera (cuotas diferidas más intereses). Sin el extracto
 * solo se puede estimar; por defecto, una treintaiseisava parte redondeada, que es el plazo
 * habitual de las compras diferidas en Colombia.
 */
export const DEFAULT_MINIMUM_RULE: MinimumPaymentRule = { basisPoints: 278n };

export function estimateMinimumPayment(
  amountDue: Money,
  rule: MinimumPaymentRule = DEFAULT_MINIMUM_RULE,
): Money {
  if (amountDue.isZero() || amountDue.isNegative()) return Money.zero(amountDue.currencyCode);
  const raw = divideRounded(amountDue.amountMinor * rule.basisPoints, 10_000n, "ceil");
  // Se redondea hacia arriba a la unidad mayor (pesos enteros) y nunca supera lo adeudado.
  const unit = 100n;
  const whole = divideRounded(raw, unit, "ceil") * unit;
  const capped = whole > amountDue.amountMinor ? amountDue.amountMinor : whole;
  return Money.ofMinor(capped, amountDue.currencyCode);
}

/** Movimientos de la tarjeta, ya sumados por la capa de datos. */
export interface CardFigures {
  /** Saldo de la cuenta hoy (negativo = deuda). */
  readonly balance: Money;
  /** Saldo de la cuenta al cierre del último corte (negativo = deuda). */
  readonly balanceAtLastClosing: Money;
  /** Suma de abonos (asientos positivos) después del último corte. */
  readonly paidSinceClosing: Money;
  /** Suma de cargos (asientos negativos, en valor absoluto) en el ciclo abierto. */
  readonly chargesThisCycle: Money;
}

export interface CardSummary {
  readonly cycle: StatementCycle;
  readonly lastStatement: StatementCycle;
  /** Lo que se debe hoy en total. */
  readonly debt: Money;
  /** Saldo del extracto que falta pagar (no baja de cero). */
  readonly amountDue: Money;
  readonly minimumPayment: Money;
  readonly chargesThisCycle: Money;
  /** Cupo menos deuda; `null` si la tarjeta no tiene cupo configurado. */
  readonly available: Money | null;
  /** Días hasta el pago del último extracto; negativo si ya venció. */
  readonly daysUntilDue: number;
}

const positive = (m: Money): Money => (m.isNegative() ? Money.zero(m.currencyCode) : m);

export function summarizeCard(
  account: Account,
  days: BillingDays,
  today: CivilDate,
  figures: CardFigures,
  rule: MinimumPaymentRule = DEFAULT_MINIMUM_RULE,
): CardSummary {
  const debt = positive(figures.balance.negate());
  const statementDebt = positive(figures.balanceAtLastClosing.negate());
  const amountDue = positive(statementDebt.subtract(figures.paidSinceClosing));
  const lastStatement = lastClosedCycle(days, today);
  return {
    cycle: currentCycle(days, today),
    lastStatement,
    debt,
    amountDue,
    minimumPayment: estimateMinimumPayment(amountDue, rule),
    chargesThisCycle: figures.chargesThisCycle,
    available: account.creditLimit ? account.creditLimit.add(figures.balance) : null,
    daysUntilDue: daysBetween(today, lastStatement.due),
  };
}

/**
 * Cuándo avisar del pago: unos días antes y el mismo día, solo fechas que aún no pasan.
 * Si ya se pagó todo el extracto, no hay nada que recordar.
 */
export function paymentReminderDates(
  due: CivilDate,
  today: CivilDate,
  daysBefore: readonly number[] = [3, 0],
): CivilDate[] {
  const base = Date.UTC(due.year, due.month - 1, due.day);
  return [...new Set(daysBefore)]
    .sort((a, b) => b - a)
    .map((n) => {
      const d = new Date(base - n * 86_400_000);
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    })
    .filter((d) => compareCivil(d, today) >= 0);
}
