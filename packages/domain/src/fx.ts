import type { CurrencyCode } from "./currency";
import { Money } from "./money";

/** Tasas hacia una moneda base: unidades de la base por una unidad de cada moneda (USD → "4012.35"). */
export type RateTable = ReadonlyMap<CurrencyCode, string>;

/** Convierte a la moneda base con la tasa de la tabla; `null` si no hay tasa para esa moneda. */
export function toBase(money: Money, base: CurrencyCode, rates: RateTable): Money | null {
  if (money.currencyCode === base) return money;
  const rate = rates.get(money.currencyCode);
  return rate ? money.convert(rate, base) : null;
}

export interface BaseTotal {
  readonly total: Money;
  /** Monedas que no se pudieron sumar por falta de tasa. */
  readonly missing: readonly CurrencyCode[];
}

/** Suma montos de varias monedas en la base; lo que no tiene tasa queda por fuera y se informa. */
export function sumInBase(
  amounts: readonly Money[],
  base: CurrencyCode,
  rates: RateTable,
): BaseTotal {
  let total = Money.zero(base);
  const missing = new Set<CurrencyCode>();
  for (const m of amounts) {
    const converted = toBase(m, base, rates);
    if (converted) total = total.add(converted);
    else missing.add(m.currencyCode);
  }
  return { total, missing: [...missing] };
}
