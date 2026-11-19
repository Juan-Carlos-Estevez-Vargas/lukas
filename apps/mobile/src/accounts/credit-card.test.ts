import type { Account } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import type { SqlConnection } from "../data/sql";
import { cardFixture, cop, local } from "./card.test-helper";
import { cardSummary, civilDate, parseDay, startOfDay } from "./credit-card";

async function summary(db: SqlConnection, card: Account, today: Date) {
  const res = await cardSummary(db, card, civilDate(today));
  if (!res.ok) throw res.error;
  return res.value;
}

describe("fechas locales", () => {
  it("usa el calendario del teléfono", () => {
    expect(civilDate(local(2026, 11, 19, 23))).toEqual({ year: 2026, month: 11, day: 19 });
    expect(startOfDay({ year: 2026, month: 11, day: 19 })).toBe(
      local(2026, 11, 19, 0).toISOString(),
    );
  });
});

describe("parseDay", () => {
  it("acepta 1 a 31 y vacío", () => {
    expect(parseDay("")).toBeNull();
    expect(parseDay(" 15 ")).toBe(15);
    expect(parseDay("31")).toBe(31);
    expect(parseDay("0")).toBeUndefined();
    expect(parseDay("32")).toBeUndefined();
    expect(parseDay("1a")).toBeUndefined();
  });
});

describe("cardSummary", () => {
  it("guarda cupo y días al crear la tarjeta", async () => {
    const { card } = await cardFixture({ closingDay: 15, dueDay: 2 });
    expect(card).toMatchObject({ type: "credit_card", closingDay: 15, dueDay: 2 });
    expect(card.creditLimit?.equals(cop(5_000_000n))).toBe(true);
  });

  it("separa lo del extracto, lo abonado y las compras del ciclo abierto", async () => {
    const { db, card, move } = await cardFixture({ closingDay: 15, dueDay: 2 });
    await move(cop(-800_000n), local(2026, 10, 20)); // ciclo que cerró el 15/nov
    await move(cop(-400_000n), local(2026, 11, 15, 23)); // último día de ese ciclo
    await move(cop(300_000n), local(2026, 11, 17)); // abono después del corte
    await move(cop(-250_000n), local(2026, 11, 18)); // compra del ciclo abierto
    const s = await summary(db, card, local(2026, 11, 19));
    expect(s.debt.equals(cop(1_150_000n))).toBe(true);
    expect(s.amountDue.equals(cop(900_000n))).toBe(true);
    expect(s.chargesThisCycle.equals(cop(250_000n))).toBe(true);
    expect(s.available?.equals(cop(3_850_000n))).toBe(true);
    expect(s.lastStatement.due).toEqual({ year: 2026, month: 12, day: 2 });
    expect(s.minimumPayment.isZero()).toBe(false);
  });

  it("pide los días si faltan", async () => {
    const { db, card } = await cardFixture({ closingDay: null, dueDay: null });
    const res = await cardSummary(db, card, civilDate(local(2026, 11, 19)));
    expect(!res.ok && res.error.code).toBe("billing_days_missing");
  });
});
