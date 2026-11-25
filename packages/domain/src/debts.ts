import { Money } from "./money";

/**
 * Deudas (FIN-602): estrategias bola de nieve y avalancha y abonos a capital. Los montos son
 * siempre `Money` (enteros); solo la tasa mensual se calcula en punto flotante y se pasa a texto
 * con 9 decimales antes de multiplicar, así que el interés de cada mes es exacto y reproducible.
 */

export interface Debt {
  readonly id: string;
  readonly name: string;
  /** Lo que se debe hoy (positivo). */
  readonly balance: Money;
  /** Tasa efectiva anual en puntos básicos: 2899 = 28,99 % E.A. */
  readonly annualRateBp: number;
  /** Pago mínimo mensual. */
  readonly minPayment: Money;
}

export type DebtStrategy = "snowball" | "avalanche";

export interface DebtPayoff {
  readonly id: string;
  /** Mes (desde 1) en que queda en cero. */
  readonly month: number;
  readonly interest: Money;
}

export type DebtPlan =
  | {
      readonly ok: true;
      readonly months: number;
      readonly totalInterest: Money;
      readonly totalPaid: Money;
      /** En el orden en que se terminan de pagar. */
      readonly payoffs: readonly DebtPayoff[];
    }
  | { readonly ok: false; readonly reason: "budget_below_minimums" | "never_ends" | "empty" };

/** Tope de la simulación: 50 años. */
export const MAX_MONTHS = 600;

/** Tasa mensual equivalente a una efectiva anual, como texto decimal para `Money.multiply`. */
export function monthlyRateFactor(annualRateBp: number): string {
  if (!Number.isFinite(annualRateBp) || annualRateBp < 0) throw new RangeError("Tasa inválida");
  const monthly = (1 + annualRateBp / 10_000) ** (1 / 12) - 1;
  return monthly.toFixed(9);
}

const sum = (values: readonly Money[], currency: Money): Money =>
  values.reduce((a, b) => a.add(b), Money.zero(currency.currencyCode));

const order = (strategy: DebtStrategy) => (a: Live, b: Live) => {
  if (strategy === "snowball") {
    const byBalance = a.balance.compare(b.balance);
    if (byBalance !== 0) return byBalance;
  } else if (a.debt.annualRateBp !== b.debt.annualRateBp) {
    return b.debt.annualRateBp - a.debt.annualRateBp;
  }
  return a.index - b.index;
};

interface Live {
  readonly debt: Debt;
  readonly index: number;
  readonly factor: string;
  balance: Money;
  interest: Money;
}

/**
 * Simula mes a mes: se suman los intereses, se paga el mínimo de cada deuda y todo lo que sobre
 * del presupuesto va a la deuda que toca según la estrategia. Al terminar una, su mínimo pasa a
 * la siguiente (el presupuesto mensual no cambia).
 */
export function planDebts(
  debts: readonly Debt[],
  monthlyBudget: Money,
  strategy: DebtStrategy,
): DebtPlan {
  const open = debts.filter((d) => !d.balance.isZero() && !d.balance.isNegative());
  if (open.length === 0) return { ok: false, reason: "empty" };
  const zero = Money.zero(monthlyBudget.currencyCode);
  const minimums = sum(
    open.map((d) => d.minPayment),
    monthlyBudget,
  );
  if (monthlyBudget.compare(minimums) < 0 || monthlyBudget.isZero()) {
    return { ok: false, reason: "budget_below_minimums" };
  }
  const live: Live[] = open.map((debt, index) => ({
    debt,
    index,
    factor: monthlyRateFactor(debt.annualRateBp),
    balance: debt.balance,
    interest: zero,
  }));
  const payoffs: DebtPayoff[] = [];
  let paid = zero;

  for (let month = 1; month <= MAX_MONTHS; month++) {
    const active = live.filter((l) => !l.balance.isZero());
    for (const l of active) {
      const interest = l.balance.multiply(l.factor, "half-up");
      l.balance = l.balance.add(interest);
      l.interest = l.interest.add(interest);
    }
    let left = monthlyBudget;
    // Primero los mínimos (o el saldo, si es menor).
    for (const l of active) {
      const pay = l.balance.compare(l.debt.minPayment) < 0 ? l.balance : l.debt.minPayment;
      l.balance = l.balance.subtract(pay);
      left = left.subtract(pay);
    }
    // Lo que sobra, a la deuda objetivo; si se termina, a la siguiente.
    for (const l of [...active].sort(order(strategy))) {
      if (left.isZero()) break;
      if (l.balance.isZero()) continue;
      const pay = l.balance.compare(left) < 0 ? l.balance : left;
      l.balance = l.balance.subtract(pay);
      left = left.subtract(pay);
    }
    paid = paid.add(monthlyBudget.subtract(left));
    for (const l of active) {
      if (l.balance.isZero()) payoffs.push({ id: l.debt.id, month, interest: l.interest });
    }
    if (live.every((l) => l.balance.isZero())) {
      return {
        ok: true,
        months: month,
        totalInterest: sum(
          live.map((l) => l.interest),
          monthlyBudget,
        ),
        totalPaid: paid,
        payoffs,
      };
    }
  }
  return { ok: false, reason: "never_ends" };
}

export type PrepaymentResult =
  | {
      readonly ok: true;
      readonly baseMonths: number;
      readonly newMonths: number;
      readonly monthsSaved: number;
      readonly interestSaved: Money;
    }
  | { readonly ok: false; readonly reason: "never_ends" | "empty" | "budget_below_minimums" };

/**
 * Abonos a capital: compara pagar solo la cuota contra pagar la cuota más un abono mensual y/o un
 * abono único hoy. Devuelve cuántos meses y cuánto interés se ahorran.
 */
export function prepaymentSavings(
  debt: Debt,
  options: { readonly monthlyExtra: Money; readonly lumpSum: Money },
): PrepaymentResult {
  const base = planDebts([debt], debt.minPayment, "avalanche");
  if (!base.ok) return base;
  const lump = options.lumpSum.compare(debt.balance) > 0 ? debt.balance : options.lumpSum;
  const reduced = { ...debt, balance: debt.balance.subtract(lump) };
  if (reduced.balance.isZero()) {
    return {
      ok: true,
      baseMonths: base.months,
      newMonths: 0,
      monthsSaved: base.months,
      interestSaved: base.totalInterest,
    };
  }
  const faster = planDebts([reduced], debt.minPayment.add(options.monthlyExtra), "avalanche");
  if (!faster.ok) return faster;
  return {
    ok: true,
    baseMonths: base.months,
    newMonths: faster.months,
    monthsSaved: base.months - faster.months,
    interestSaved: base.totalInterest.subtract(faster.totalInterest),
  };
}

/** Fecha (año y mes) en que se termina de pagar, contando desde el mes actual. */
export function freedomMonth(
  from: { readonly year: number; readonly month: number },
  months: number,
): { readonly year: number; readonly month: number } {
  const index = from.year * 12 + (from.month - 1) + months;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}
