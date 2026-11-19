import { describe, expect, it } from "vitest";
import { Money } from "../money";
import { createAccount } from "./account";
import {
  addMonths,
  billingDaysOf,
  type CivilDate,
  currentCycle,
  dayIn,
  daysBetween,
  estimateMinimumPayment,
  lastClosedCycle,
  nextDay,
  paymentReminderDates,
  summarizeCard,
} from "./credit-card";

const d = (year: number, month: number, day: number): CivilDate => ({ year, month, day });
const cop = (pesos: bigint) => Money.ofMinor(pesos * 100n, "COP");
const now = new Date("2026-11-19T12:00:00Z");

function card(closingDay: number | null, dueDay: number | null, limit: Money | null = null) {
  const res = createAccount(
    { name: "Visa", type: "credit_card", currency: "COP", closingDay, dueDay, creditLimit: limit },
    "c1",
    now,
  );
  if (!res.ok) throw res.error;
  return res.value;
}

describe("fechas de calendario", () => {
  it("ajusta el día al largo del mes", () => {
    expect(dayIn(2026, 2, 31)).toEqual(d(2026, 2, 28));
    expect(dayIn(2028, 2, 31)).toEqual(d(2028, 2, 29));
    expect(dayIn(2026, 4, 31)).toEqual(d(2026, 4, 30));
  });

  it("suma meses cruzando años", () => {
    expect(addMonths(2026, 12, 1)).toEqual([2027, 1]);
    expect(addMonths(2026, 1, -1)).toEqual([2025, 12]);
  });

  it("avanza al día siguiente y cuenta días", () => {
    expect(nextDay(d(2026, 12, 31))).toEqual(d(2027, 1, 1));
    expect(nextDay(d(2026, 2, 28))).toEqual(d(2026, 3, 1));
    expect(daysBetween(d(2026, 11, 19), d(2026, 12, 2))).toBe(13);
  });
});

describe("ciclos de facturación", () => {
  const days = { closingDay: 15, dueDay: 2 };

  it("el ciclo abierto va del día después del corte anterior hasta el corte", () => {
    expect(currentCycle(days, d(2026, 11, 10))).toEqual({
      opens: d(2026, 10, 16),
      closes: d(2026, 11, 15),
      due: d(2026, 12, 2),
    });
    expect(currentCycle(days, d(2026, 11, 15)).closes).toEqual(d(2026, 11, 15));
  });

  it("después del corte, el ciclo abierto es el del mes siguiente", () => {
    expect(currentCycle(days, d(2026, 12, 20))).toEqual({
      opens: d(2026, 12, 16),
      closes: d(2027, 1, 15),
      due: d(2027, 2, 2),
    });
  });

  it("si el pago es después del corte, se paga el mismo mes", () => {
    expect(lastClosedCycle({ closingDay: 5, dueDay: 20 }, d(2026, 11, 19))).toEqual({
      opens: d(2026, 10, 6),
      closes: d(2026, 11, 5),
      due: d(2026, 11, 20),
    });
  });

  it("corte a fin de mes en febrero", () => {
    expect(currentCycle({ closingDay: 31, dueDay: 15 }, d(2026, 2, 10))).toEqual({
      opens: d(2026, 2, 1),
      closes: d(2026, 2, 28),
      due: d(2026, 3, 15),
    });
  });
});

describe("billingDaysOf", () => {
  it("exige que sea tarjeta y tenga los días", () => {
    expect(billingDaysOf(card(15, 2))).toEqual({ ok: true, value: { closingDay: 15, dueDay: 2 } });
    const missing = billingDaysOf(card(null, 2));
    expect(!missing.ok && missing.error.code).toBe("billing_days_missing");
    const bank = createAccount({ name: "Ahorros", type: "bank", currency: "COP" }, "b", now);
    if (!bank.ok) throw bank.error;
    const res = billingDaysOf(bank.value);
    expect(!res.ok && res.error.code).toBe("not_a_credit_card");
  });
});

describe("pago mínimo estimado", () => {
  it("es cero si no se debe nada o hay saldo a favor", () => {
    expect(estimateMinimumPayment(cop(0n)).isZero()).toBe(true);
    expect(estimateMinimumPayment(cop(-5_000n)).isZero()).toBe(true);
  });

  it("redondea hacia arriba a pesos enteros", () => {
    // 2,78 % de 1.000.000 = 27.800
    expect(estimateMinimumPayment(cop(1_000_000n)).equals(cop(27_800n))).toBe(true);
    // 2,78 % de 1.234 = 34,3 → 35
    expect(estimateMinimumPayment(cop(1_234n)).equals(cop(35n))).toBe(true);
  });

  it("nunca supera lo adeudado", () => {
    const due = Money.ofMinor(50n, "COP");
    expect(estimateMinimumPayment(due, { basisPoints: 10_000n }).equals(due)).toBe(true);
  });
});

describe("summarizeCard", () => {
  const account = card(15, 2, cop(5_000_000n));
  const days = { closingDay: 15, dueDay: 2 };

  it("calcula deuda, saldo a pagar, cupo disponible y días al pago", () => {
    const s = summarizeCard(account, days, d(2026, 11, 19), {
      balance: cop(-1_500_000n),
      balanceAtLastClosing: cop(-1_200_000n),
      paidSinceClosing: cop(200_000n),
      chargesThisCycle: cop(500_000n),
    });
    expect(s.debt.equals(cop(1_500_000n))).toBe(true);
    expect(s.amountDue.equals(cop(1_000_000n))).toBe(true);
    expect(s.minimumPayment.equals(cop(27_800n))).toBe(true);
    expect(s.available?.equals(cop(3_500_000n))).toBe(true);
    expect(s.chargesThisCycle.equals(cop(500_000n))).toBe(true);
    expect(s.lastStatement.due).toEqual(d(2026, 12, 2));
    expect(s.cycle.closes).toEqual(d(2026, 12, 15));
    expect(s.daysUntilDue).toBe(13);
  });

  it("con saldo a favor no se debe nada; sin cupo, el disponible es nulo", () => {
    const noLimit = card(15, 2);
    const s = summarizeCard(noLimit, days, d(2026, 11, 19), {
      balance: cop(100_000n),
      balanceAtLastClosing: cop(-300_000n),
      paidSinceClosing: cop(400_000n),
      chargesThisCycle: cop(0n),
    });
    expect(s.debt.isZero()).toBe(true);
    expect(s.amountDue.isZero()).toBe(true);
    expect(s.minimumPayment.isZero()).toBe(true);
    expect(s.available).toBeNull();
  });
});

describe("paymentReminderDates", () => {
  it("avisa 3 días antes y el mismo día", () => {
    expect(paymentReminderDates(d(2026, 12, 2), d(2026, 11, 19))).toEqual([
      d(2026, 11, 29),
      d(2026, 12, 2),
    ]);
  });

  it("omite fechas pasadas", () => {
    expect(paymentReminderDates(d(2026, 12, 2), d(2026, 12, 1))).toEqual([d(2026, 12, 2)]);
    expect(paymentReminderDates(d(2026, 12, 2), d(2026, 12, 3))).toEqual([]);
  });
});
