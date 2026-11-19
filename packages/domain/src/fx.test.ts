import { describe, expect, it } from "vitest";
import { sumInBase, toBase } from "./fx";
import { Money } from "./money";

const rates = new Map([["USD", "4012.35"]] as const);

describe("conversión a la moneda base", () => {
  it("convierte dólares a pesos con la TRM, redondeando al centavo", () => {
    // US$ 1.234,56 × 4.012,35 = $ 4.953.486,816 → 4.953.486,82
    expect(toBase(Money.ofMinor(123_456n, "USD"), "COP", rates)).toEqual(
      Money.ofMinor(495_348_682n, "COP"),
    );
    const cop = Money.ofMinor(100n, "COP");
    expect(toBase(cop, "COP", rates)).toBe(cop);
    expect(toBase(Money.ofMinor(1n, "EUR"), "COP", rates)).toBeNull();
  });

  it("suma varias monedas e informa las que no tienen tasa", () => {
    const r = sumInBase(
      [
        Money.ofMinor(1_000_000n, "COP"),
        Money.ofMinor(100n, "USD"),
        Money.ofMinor(-50n, "USD"),
        Money.ofMinor(500n, "EUR"),
        Money.ofMinor(1n, "EUR"),
      ],
      "COP",
      rates,
    );
    expect(r.total).toEqual(Money.ofMinor(1_000_000n + 401_235n - 200_618n, "COP"));
    expect(r.missing).toEqual(["EUR"]);
  });
});
