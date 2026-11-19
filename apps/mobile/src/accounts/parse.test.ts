import { DomainError, Money } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { accountErrorKey } from "./messages";
import { parseAmount, parsePesos } from "./parse";

describe("parsePesos", () => {
  it.each([
    ["150.000", 150_000_00n],
    ["150000", 150_000_00n],
    ["-20.000", -20_000_00n],
    [" 1 000 ", 1_000_00n],
  ])("%s", (text, minor) => {
    expect(parsePesos(text)).toEqual(Money.ofMinor(minor, "COP"));
  });

  it("vacío es null e inválido es undefined", () => {
    expect(parsePesos("  ")).toBeNull();
    expect(parsePesos("12,5")).toBeUndefined();
    expect(parsePesos("abc")).toBeUndefined();
  });
});

describe("parseAmount", () => {
  it("en dólares acepta coma decimal y punto de miles", () => {
    expect(parseAmount("1.234,56", "USD")).toEqual(Money.ofMinor(123_456n, "USD"));
    expect(parseAmount("100", "USD")).toEqual(Money.ofMinor(10_000n, "USD"));
    expect(parseAmount("1,234", "USD")).toBeUndefined();
    expect(parseAmount("1,2,3", "EUR")).toBeUndefined();
    expect(parseAmount("", "USD")).toBeNull();
  });
});

describe("accountErrorKey", () => {
  it("traduce los códigos conocidos y cae en el genérico", () => {
    expect(accountErrorKey(new DomainError("balance_not_zero", ""))).toBe(
      "accounts.error.balance_not_zero",
    );
    expect(accountErrorKey(new DomainError("otro", ""))).toBe("accounts.error.generic");
  });
});
