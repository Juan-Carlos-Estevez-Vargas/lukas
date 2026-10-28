import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CURRENCIES, type CurrencyCode } from "./currency";
import { Money } from "./money";
import { divideRounded, type RoundingMode } from "./rounding";

const RUNS = { numRuns: 10_000 };

// Montos de hasta ±10^15 centavos: billones de pesos, muy por encima de cualquier caso real.
const amount = fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n });
const currency = fc.constantFrom(...(Object.keys(CURRENCIES) as CurrencyCode[]));
const money = fc.tuple(amount, currency).map(([minor, code]) => Money.ofMinor(minor, code));
const mode = fc.constantFrom<RoundingMode>("half-even", "half-up", "floor", "ceil");
const decimalText = fc
  .tuple(fc.bigInt({ min: 1n, max: 10n ** 9n }), fc.integer({ min: 0, max: 8 }))
  .map(([digits, scale]) => {
    const text = digits.toString().padStart(scale + 1, "0");
    return scale === 0 ? text : `${text.slice(0, -scale)}.${text.slice(-scale)}`;
  });

describe("propiedades de Money", () => {
  it("sumar y restar el mismo monto deja el original", () => {
    fc.assert(
      fc.property(money, amount, (m, delta) => {
        const other = Money.ofMinor(delta, m.currencyCode);
        expect(m.add(other).subtract(other).equals(m)).toBe(true);
      }),
      RUNS,
    );
  });

  it("la suma es conmutativa y asociativa", () => {
    fc.assert(
      fc.property(currency, amount, amount, amount, (code, a, b, c) => {
        const [x, y, z] = [a, b, c].map((v) => Money.ofMinor(v, code)) as [Money, Money, Money];
        expect(x.add(y).equals(y.add(x))).toBe(true);
        expect(
          x
            .add(y)
            .add(z)
            .equals(x.add(y.add(z))),
        ).toBe(true);
      }),
      RUNS,
    );
  });

  it("repartir nunca pierde ni crea centavos", () => {
    fc.assert(
      fc.property(
        money,
        fc.array(fc.bigInt({ min: 0n, max: 1000n }), { minLength: 1, maxLength: 12 }),
        (m, weights) => {
          fc.pre(weights.some((w) => w > 0n));
          const parts = m.allocate(weights);
          const total = parts.reduce((sum, p) => sum.add(p), Money.zero(m.currencyCode));
          expect(total.equals(m)).toBe(true);
          // Ninguna parte se aleja más de un centavo de su proporción exacta.
          const weightSum = weights.reduce((s, w) => s + w, 0n);
          parts.forEach((part, i) => {
            const exact = m.amountMinor * (weights[i] ?? 0n);
            const diff = part.amountMinor * weightSum - exact;
            expect(diff < 0n ? -diff : diff).toBeLessThan(weightSum);
          });
        },
      ),
      RUNS,
    );
  });

  it("multiplicar por 1 no cambia el monto", () => {
    fc.assert(
      fc.property(money, mode, (m, rounding) => {
        expect(m.multiply("1", rounding).equals(m)).toBe(true);
        expect(m.multiply("1.000", rounding).equals(m)).toBe(true);
      }),
      RUNS,
    );
  });

  it("el texto decimal se puede volver a leer sin pérdida", () => {
    fc.assert(
      fc.property(money, (m) => {
        const parsed = Money.parse(m.toDecimalString(), m.currencyCode);
        expect(parsed.ok && parsed.value.equals(m)).toBe(true);
      }),
      RUNS,
    );
  });

  it("convertir con una tasa redondea a menos de un centavo del valor exacto", () => {
    fc.assert(
      fc.property(money, currency, decimalText, (m, target, rate) => {
        const converted = m.convert(rate, target, "half-even");
        const [whole = "", fraction = ""] = rate.split(".");
        const rateValue = BigInt(whole + fraction);
        const shift = CURRENCIES[target].minorUnits - m.currency.minorUnits;
        // valor exacto = numerador / denominador, en unidades menores del destino
        let numerator = m.amountMinor * rateValue;
        let denominator = 10n ** BigInt(fraction.length);
        if (shift >= 0) numerator *= 10n ** BigInt(shift);
        else denominator *= 10n ** BigInt(-shift);
        const error = converted.amountMinor * denominator - numerator;
        // |redondeado - exacto| <= 1/2 centavo
        expect((error < 0n ? -error : error) * 2n).toBeLessThanOrEqual(denominator);
      }),
      RUNS,
    );
  });
});

describe("propiedades de divideRounded", () => {
  it("el cociente queda a menos de una unidad del valor exacto y respeta el modo", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 18n), max: 10n ** 18n }),
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        mode,
        (n, d, rounding) => {
          const q = divideRounded(n, d, rounding);
          const diff = q * d - n; // (q - n/d) * d
          expect(diff < 0n ? -diff : diff).toBeLessThan(d);
          if (rounding === "floor") expect(diff <= 0n).toBe(true);
          if (rounding === "ceil") expect(diff >= 0n).toBe(true);
          if (rounding === "half-even" || rounding === "half-up") {
            expect((diff < 0n ? -diff : diff) * 2n).toBeLessThanOrEqual(d);
          }
        },
      ),
      RUNS,
    );
  });
});
