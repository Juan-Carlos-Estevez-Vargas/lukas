import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import { Money } from "./money";

const cop = (minor: bigint) => Money.ofMinor(minor, "COP");

describe("Money", () => {
  describe("parse", () => {
    it("convierte unidades mayores a centavos sin punto flotante", () => {
      const result = Money.parse("45900.50", "COP");
      expect(result.ok && result.value.amountMinor).toBe(4590050n);
      const big = Money.parse("90071992547409.93", "COP");
      expect(big.ok && big.value.amountMinor).toBe(9007199254740993n);
    });

    it("acepta montos sin decimales y negativos", () => {
      const result = Money.parse("-1200", "USD");
      expect(result.ok && result.value.amountMinor).toBe(-120000n);
    });

    it("rechaza texto inválido o con demasiados decimales", () => {
      const invalid = Money.parse("12,5", "COP");
      expect(!invalid.ok && invalid.error.code).toBe("invalid_amount");
      const tooMany = Money.parse("1.005", "USD");
      expect(!tooMany.ok && tooMany.error.code).toBe("too_many_decimals");
      const clp = Money.parse("10.5", "CLP");
      expect(!clp.ok && clp.error.code).toBe("too_many_decimals");
    });
  });

  it("suma y resta en la misma moneda", () => {
    expect(cop(1000n).add(cop(250n)).amountMinor).toBe(1250n);
    expect(cop(1000n).subtract(cop(2500n)).amountMinor).toBe(-1500n);
    expect(cop(5n).negate().amountMinor).toBe(-5n);
  });

  it("no permite operar monedas distintas", () => {
    expect(() => cop(1n).add(Money.ofMinor(1n, "USD"))).toThrow(DomainError);
    expect(() => cop(1n).compare(Money.ofMinor(1n, "USD"))).toThrow(/COP y USD/);
  });

  it("multiplica por factores decimales con redondeo", () => {
    // IVA del 19 % sobre $10.000,05
    expect(cop(1000005n).multiply("0.19").amountMinor).toBe(190001n);
    // 4×1000 sobre $1.234.567: 4938,268 → 4938,27
    expect(cop(123456700n).multiply("0.004").amountMinor).toBe(493827n);
    expect(cop(5n).multiply("0.5", "half-even").amountMinor).toBe(2n);
    expect(cop(5n).multiply("0.5", "half-up").amountMinor).toBe(3n);
    expect(() => cop(1n).multiply("abc")).toThrow(RangeError);
  });

  describe("allocate", () => {
    it("reparte sin perder centavos", () => {
      const parts = cop(10000n).allocate([1n, 1n, 1n]);
      expect(parts.map((p) => p.amountMinor)).toEqual([3334n, 3333n, 3333n]);
    });

    it("respeta proporciones y montos negativos", () => {
      const parts = cop(-1000n).allocate([70n, 30n]);
      expect(parts.map((p) => p.amountMinor)).toEqual([-700n, -300n]);
    });

    it("rechaza pesos inválidos", () => {
      expect(() => cop(1n).allocate([])).toThrow(RangeError);
      expect(() => cop(1n).allocate([0n, 0n])).toThrow(RangeError);
      expect(() => cop(1n).allocate([-1n, 2n])).toThrow(RangeError);
    });
  });

  describe("convert", () => {
    it("convierte USD a COP con la TRM", () => {
      const usd = Money.ofMinor(1050n, "USD"); // USD 10,50
      const converted = usd.convert("4123.45", "COP");
      expect(converted.currencyCode).toBe("COP");
      // 43.296,225: el empate va al par con half-even y hacia arriba con half-up
      expect(converted.amountMinor).toBe(4329622n);
      expect(usd.convert("4123.45", "COP", "half-up").amountMinor).toBe(4329623n);
    });

    it("ajusta la diferencia de decimales entre monedas", () => {
      expect(Money.ofMinor(1000n, "CLP").convert("0.0011", "USD").amountMinor).toBe(110n);
      expect(Money.ofMinor(100n, "USD").convert("950", "CLP").amountMinor).toBe(950n);
    });

    it("rechaza tasas inválidas", () => {
      expect(() => cop(1n).convert("0", "USD")).toThrow(RangeError);
      expect(() => cop(1n).convert("-2", "USD")).toThrow(RangeError);
    });
  });

  it("compara y consulta el signo", () => {
    expect(cop(1n).compare(cop(2n))).toBe(-1);
    expect(cop(2n).compare(cop(2n))).toBe(0);
    expect(cop(3n).compare(cop(2n))).toBe(1);
    expect(cop(0n).isZero()).toBe(true);
    expect(cop(-1n).isNegative()).toBe(true);
    expect(cop(1n).equals(Money.ofMinor(1n, "USD"))).toBe(false);
    expect(Money.zero("USD").equals(Money.ofMinor(0n, "USD"))).toBe(true);
  });

  it("formatea como decimal exacto y serializa a JSON", () => {
    expect(cop(4590050n).toDecimalString()).toBe("45900.50");
    expect(cop(-5n).toDecimalString()).toBe("-0.05");
    expect(Money.ofMinor(1500n, "CLP").toDecimalString()).toBe("1500");
    expect(JSON.stringify(cop(12n))).toBe('{"amountMinor":"12","currency":"COP"}');
  });
});
