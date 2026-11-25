import { Money } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { cardFixture, cop, local } from "../accounts/card.test-helper";
import { sqlitePreferences } from "../data/preferences";
import { debtsForPlan, formatRate, loadDebts, parseRate, saveTerms } from "./debts";

describe("deudas en el teléfono", () => {
  it("lista la tarjeta con lo que se debe y guarda sus condiciones", async () => {
    const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
    await fx.move(cop(-1_200_000n), local(2026, 11, 3));
    let rows = await loadDebts(fx.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.owed.equals(cop(1_200_000n))).toBe(true);
    expect(rows[0]?.terms).toBeNull();
    expect(debtsForPlan(rows).missingTerms).toHaveLength(1);

    await saveTerms(fx.db, fx.card.id, { annualRateBp: 2899, minPaymentMinor: "10000000" });
    rows = await loadDebts(fx.db);
    const { debts, missingTerms } = debtsForPlan(rows);
    expect(missingTerms).toEqual([]);
    expect(debts[0]).toMatchObject({ id: fx.card.id, annualRateBp: 2899 });
    expect(debts[0]?.minPayment.equals(Money.ofMinor(10_000_000n, "COP"))).toBe(true);
  });

  it("una tarjeta al día no entra en el plan, y las condiciones dañadas se ignoran", async () => {
    const fx = await cardFixture({ closingDay: 15, dueDay: 2 });
    await sqlitePreferences(fx.db).set(
      "debts.terms",
      JSON.stringify({ [fx.card.id]: { annualRateBp: -5, minPaymentMinor: "x" } }),
    );
    const rows = await loadDebts(fx.db);
    expect(rows[0]?.terms).toBeNull();
    expect(debtsForPlan(rows)).toEqual({ debts: [], missingTerms: [] });
    await sqlitePreferences(fx.db).set("debts.terms", "{roto");
    expect((await loadDebts(fx.db))[0]?.terms).toBeNull();
  });

  it("lee y muestra tasas como se escriben en Colombia", () => {
    expect(parseRate("28,99")).toBe(2899);
    expect(parseRate("28.9")).toBe(2890);
    expect(parseRate("18 %")).toBeNull();
    expect(parseRate("18%")).toBe(1800);
    expect(parseRate("abc")).toBeNull();
    expect(parseRate("250")).toBeNull();
    expect(formatRate(2899)).toBe("28,99");
    expect(formatRate(1800)).toBe("18");
    expect(formatRate(1805)).toBe("18,05");
  });
});
