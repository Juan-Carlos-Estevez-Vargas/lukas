import { Money } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { formatMoney, HIDDEN_AMOUNT } from "./money";

const cop = (n: bigint) => Money.ofMinor(n, "COP");

describe("formatMoney", () => {
  it.each([
    [cop(123_456_700n), "es", "$ 1.234.567"],
    [cop(4_590_050n), "es", "$ 45.900,50"],
    [cop(-4_590_050n), "es", "-$ 45.900,50"],
    [cop(0n), "es", "$ 0"],
    [cop(99n), "es", "$ 0,99"],
    [cop(123_456_700n), "en", "$1,234,567"],
    [Money.ofMinor(1050n, "USD"), "es", "US$ 10,50"],
    [Money.ofMinor(1000n, "USD"), "en", "US$ 10.00"],
    [Money.ofMinor(1500n, "CLP"), "es", "CLP 1.500"],
  ] as const)("%s en %s → %s", (money, locale, text) => {
    expect(formatMoney(money, { locale })).toBe(text);
  });

  it("muestra los centavos en cero si se pide", () => {
    expect(formatMoney(cop(100n), { locale: "es", alwaysShowCents: true })).toBe("$ 1,00");
  });

  it("oculta la cifra en modo discreto sin revelar el signo ni el tamaño", () => {
    expect(formatMoney(cop(-999_999_999n), { locale: "es", discreet: true })).toBe(
      `$ ${HIDDEN_AMOUNT}`,
    );
  });
});
