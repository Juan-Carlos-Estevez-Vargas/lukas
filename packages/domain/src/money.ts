import { CURRENCIES, type Currency, type CurrencyCode } from "./currency";
import { DomainError } from "./errors";
import { err, ok, type Result } from "./result";
import { divideRounded, parseDecimal, pow10, type RoundingMode } from "./rounding";

/**
 * Cantidad de dinero inmutable en una moneda.
 * El monto se guarda como entero de unidades menores (centavos), nunca como punto flotante.
 */
export class Money {
  private constructor(
    readonly amountMinor: bigint,
    readonly currency: Currency,
  ) {}

  static ofMinor(amountMinor: bigint, currency: CurrencyCode): Money {
    return new Money(amountMinor, CURRENCIES[currency]);
  }

  static zero(currency: CurrencyCode): Money {
    return Money.ofMinor(0n, currency);
  }

  /** Crea dinero desde unidades mayores en texto: "45900.50" COP → 4590050 centavos. */
  static parse(text: string, currency: CurrencyCode): Result<Money, DomainError> {
    const decimal = parseDecimal(text);
    const { minorUnits } = CURRENCIES[currency];
    if (!decimal) {
      return err(new DomainError("invalid_amount", `Monto inválido: ${text}`));
    }
    if (decimal.scale > minorUnits) {
      return err(
        new DomainError("too_many_decimals", `${currency} admite máximo ${minorUnits} decimales`),
      );
    }
    return ok(Money.ofMinor(decimal.value * pow10(minorUnits - decimal.scale), currency));
  }

  get currencyCode(): CurrencyCode {
    return this.currency.code as CurrencyCode;
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor + other.amountMinor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor - other.amountMinor, this.currency);
  }

  negate(): Money {
    return new Money(-this.amountMinor, this.currency);
  }

  /** Multiplica por un factor decimal exacto en texto ("1.19", "0.004") con el redondeo indicado. */
  multiply(factor: string, rounding: RoundingMode = "half-even"): Money {
    const decimal = parseDecimal(factor);
    if (!decimal) throw new RangeError(`Factor inválido: ${factor}`);
    return new Money(
      divideRounded(this.amountMinor * decimal.value, pow10(decimal.scale), rounding),
      this.currency,
    );
  }

  /**
   * Reparte el monto en partes proporcionales a los pesos sin perder ni crear centavos.
   * Usa el método del mayor residuo: el sobrante se asigna a las partes con mayor fracción.
   */
  allocate(weights: readonly bigint[]): Money[] {
    if (weights.length === 0) throw new RangeError("Se necesita al menos un peso");
    if (weights.some((w) => w < 0n)) throw new RangeError("Los pesos no pueden ser negativos");
    const total = weights.reduce((sum, w) => sum + w, 0n);
    if (total === 0n) throw new RangeError("La suma de los pesos debe ser mayor que cero");

    const sign = this.amountMinor < 0n ? -1n : 1n;
    const amount = this.amountMinor * sign;
    const shares = weights.map((w) => ({ base: (amount * w) / total, rest: (amount * w) % total }));
    let leftover = amount - shares.reduce((sum, s) => sum + s.base, 0n);

    const order = shares
      .map((share, index) => ({ index, rest: share.rest }))
      .sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
    const result = shares.map((s) => s.base);
    for (const { index } of order) {
      if (leftover === 0n) break;
      result[index] = (result[index] ?? 0n) + 1n;
      leftover -= 1n;
    }
    return result.map((part) => new Money(part * sign, this.currency));
  }

  /** Convierte a otra moneda con una tasa exacta en texto (unidades destino por unidad origen). */
  convert(rate: string, target: CurrencyCode, rounding: RoundingMode = "half-even"): Money {
    const decimal = parseDecimal(rate);
    if (!decimal || decimal.value <= 0n) throw new RangeError(`Tasa inválida: ${rate}`);
    const targetCurrency = CURRENCIES[target];
    const exponentShift = targetCurrency.minorUnits - this.currency.minorUnits;
    let numerator = this.amountMinor * decimal.value;
    let denominator = pow10(decimal.scale);
    if (exponentShift >= 0) numerator *= pow10(exponentShift);
    else denominator *= pow10(-exponentShift);
    return new Money(divideRounded(numerator, denominator, rounding), targetCurrency);
  }

  isZero(): boolean {
    return this.amountMinor === 0n;
  }

  isNegative(): boolean {
    return this.amountMinor < 0n;
  }

  equals(other: Money): boolean {
    return this.currency.code === other.currency.code && this.amountMinor === other.amountMinor;
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.amountMinor === other.amountMinor) return 0;
    return this.amountMinor < other.amountMinor ? -1 : 1;
  }

  /** Monto en unidades mayores como texto exacto: 4590050 centavos COP → "45900.50". */
  toDecimalString(): string {
    const { minorUnits } = this.currency;
    const negative = this.amountMinor < 0n;
    const digits = (negative ? -this.amountMinor : this.amountMinor)
      .toString()
      .padStart(minorUnits + 1, "0");
    const whole = digits.slice(0, digits.length - minorUnits);
    const fraction = digits.slice(digits.length - minorUnits);
    return `${negative ? "-" : ""}${whole}${minorUnits > 0 ? `.${fraction}` : ""}`;
  }

  toJSON(): { amountMinor: string; currency: string } {
    return { amountMinor: this.amountMinor.toString(), currency: this.currency.code };
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency.code !== other.currency.code) {
      throw new DomainError(
        "currency_mismatch",
        `No se pueden operar ${this.currency.code} y ${other.currency.code}`,
      );
    }
  }
}
