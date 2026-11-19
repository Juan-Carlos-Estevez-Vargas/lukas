import { describe, expect, it } from "vitest";
import { Money } from "../money";
import { goalProgress, monthlyContributionsLeft, validateGoal } from "./goal";

const d = (year: number, month: number, day: number) => ({ year, month, day });
const cop = (pesos: bigint) => Money.ofMinor(pesos * 100n, "COP");

describe("metas de ahorro", () => {
  it("cuenta los aportes mensuales que quedan, incluido el de hoy", () => {
    expect(monthlyContributionsLeft(d(2026, 11, 19), d(2026, 11, 19))).toBe(1);
    expect(monthlyContributionsLeft(d(2026, 11, 19), d(2026, 12, 18))).toBe(1);
    expect(monthlyContributionsLeft(d(2026, 11, 19), d(2026, 12, 19))).toBe(2);
    expect(monthlyContributionsLeft(d(2026, 11, 19), d(2027, 11, 30))).toBe(13);
    expect(monthlyContributionsLeft(d(2026, 11, 19), d(2026, 11, 18))).toBe(0);
  });

  it("dice cuánto apartar por mes, redondeado hacia arriba a pesos enteros", () => {
    const p = goalProgress(cop(3_000_000n), cop(500_000n), d(2026, 11, 19), d(2027, 4, 30));
    expect(p.contributionsLeft).toBe(6);
    // 2.500.000 / 6 = 416.666,67 → 416.667
    expect(p.monthly).toEqual(cop(416_667n));
    expect(p.percent).toBe(16);
    expect(p.remaining).toEqual(cop(2_500_000n));
    expect(p.done).toBe(false);
    expect(p.overdue).toBe(false);
  });

  it("meta cumplida, vencida y saldo negativo", () => {
    const done = goalProgress(cop(100n), cop(150n), d(2026, 1, 1), d(2026, 6, 1));
    expect(done).toMatchObject({ done: true, percent: 100, monthly: null });
    expect(done.remaining.isZero()).toBe(true);

    const late = goalProgress(cop(100n), cop(40n), d(2026, 7, 1), d(2026, 6, 1));
    expect(late.overdue).toBe(true);
    expect(late.monthly).toEqual(cop(60n));

    const negative = goalProgress(cop(100n), cop(-40n), d(2026, 1, 1), d(2026, 1, 31));
    expect(negative.saved.isZero()).toBe(true);
    expect(negative.percent).toBe(0);
  });

  it("valida nombre, monto y fecha", () => {
    const base = {
      name: " Viaje  a Cartagena ",
      target: cop(1n),
      targetDate: d(2027, 1, 1),
      today: d(2026, 1, 1),
    };
    expect(validateGoal(base)).toEqual({ ok: true, value: "Viaje a Cartagena" });
    const code = (o: Partial<typeof base>) => {
      const r = validateGoal({ ...base, ...o });
      return r.ok ? null : r.error.code;
    };
    expect(code({ name: " " })).toBe("goal_name_required");
    expect(code({ target: cop(0n) })).toBe("invalid_amount");
    expect(code({ targetDate: d(2025, 12, 31) })).toBe("goal_date_past");
  });
});
