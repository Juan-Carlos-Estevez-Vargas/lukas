/** Modos de redondeo para operaciones que no caben exactamente en la unidad menor. */
export type RoundingMode =
  /** Al par más cercano (redondeo bancario). Evita sesgo al acumular. */
  | "half-even"
  /** Al más cercano; los empates se alejan de cero. */
  | "half-up"
  /** Hacia menos infinito. */
  | "floor"
  /** Hacia más infinito. */
  | "ceil";

const abs = (n: bigint): bigint => (n < 0n ? -n : n);

/** Divide dos enteros y redondea el cociente según el modo indicado. */
export const divideRounded = (
  numerator: bigint,
  denominator: bigint,
  mode: RoundingMode,
): bigint => {
  if (denominator === 0n) throw new RangeError("División por cero");
  // Normaliza para que el denominador sea positivo.
  const n = denominator < 0n ? -numerator : numerator;
  const d = abs(denominator);

  // BigInt trunca hacia cero; se ajusta a partir del residuo.
  const truncated = n / d;
  const remainder = n % d;
  if (remainder === 0n) return truncated;

  const sign = n < 0n ? -1n : 1n;
  const twiceRemainder = abs(remainder) * 2n;

  switch (mode) {
    case "floor":
      return sign < 0n ? truncated - 1n : truncated;
    case "ceil":
      return sign > 0n ? truncated + 1n : truncated;
    case "half-up":
      return twiceRemainder >= d ? truncated + sign : truncated;
    case "half-even": {
      if (twiceRemainder > d) return truncated + sign;
      if (twiceRemainder < d) return truncated;
      return truncated % 2n === 0n ? truncated : truncated + sign;
    }
  }
};

/** Número decimal exacto representado como entero escalado: value / 10^scale. */
export interface ExactDecimal {
  readonly value: bigint;
  readonly scale: number;
}

const DECIMAL_PATTERN = /^([+-])?(\d+)(?:\.(\d+))?$/;

/** Interpreta un decimal en texto ("4123.45", "-0.5") sin pasar por punto flotante. */
export const parseDecimal = (text: string): ExactDecimal | undefined => {
  const match = DECIMAL_PATTERN.exec(text.trim());
  if (!match) return undefined;
  const [, sign = "+", whole = "0", fraction = ""] = match;
  const value = BigInt(whole + fraction) * (sign === "-" ? -1n : 1n);
  return { value, scale: fraction.length };
};

export const pow10 = (exponent: number): bigint => 10n ** BigInt(exponent);
