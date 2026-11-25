import type { CurrencyCode } from "./currency";
import { type CivilDate, daysBetween } from "./ledger/credit-card";
import { Money } from "./money";
import { parseDecimal } from "./rounding";

/**
 * Inversiones (FIN-601): posiciones con precio manual, simulador de CDT, rentabilidad y
 * asignación. Los montos son `Money`; los factores de interés se calculan en punto flotante y se
 * pasan a texto con 9 decimales antes de multiplicar, igual que en deudas.
 */

export const INVESTMENT_KINDS = ["cdt", "fund", "stock", "etf", "crypto", "other"] as const;
export type InvestmentKind = (typeof INVESTMENT_KINDS)[number];

export const isInvestmentKind = (v: unknown): v is InvestmentKind =>
  typeof v === "string" && (INVESTMENT_KINDS as readonly string[]).includes(v);

export interface Position {
  readonly id: string;
  readonly name: string;
  readonly kind: InvestmentKind;
  /** Unidades como decimal exacto en texto ("12.5", "0.00350000"). */
  readonly units: string;
  /** Último precio por unidad que la persona registró. */
  readonly unitPrice: Money;
  /** Lo que costó en total (incluye comisiones). */
  readonly invested: Money;
  readonly openedOn: CivilDate;
}

/** Máximo de decimales en las unidades (las criptomonedas usan 8). */
export const MAX_UNIT_DECIMALS = 8;

/** Unidades válidas: positivas y con a lo sumo 8 decimales. */
export function validUnits(units: string): boolean {
  const d = parseDecimal(units);
  return d !== undefined && d.value > 0n && d.scale <= MAX_UNIT_DECIMALS;
}

export const positionValue = (p: Position): Money => p.unitPrice.multiply(p.units, "half-even");

/** Rentabilidad simple en puntos básicos: (valor − invertido) / invertido. */
export function simpleReturnBp(invested: Money, value: Money): number | null {
  if (invested.amountMinor <= 0n) return null;
  return Number(((value.amountMinor - invested.amountMinor) * 10_000n) / invested.amountMinor);
}

/** Por debajo de un mes, anualizar exagera cualquier movimiento: no se muestra. */
export const MIN_DAYS_TO_ANNUALIZE = 30;

/** Rentabilidad efectiva anual en puntos básicos a partir de lo invertido, el valor y los días. */
export function annualizedReturnBp(invested: Money, value: Money, days: number): number | null {
  if (invested.amountMinor <= 0n || value.amountMinor < 0n || days < MIN_DAYS_TO_ANNUALIZE) {
    return null;
  }
  const ratio = Number(value.amountMinor) / Number(invested.amountMinor);
  return Math.round((ratio ** (365 / days) - 1) * 10_000);
}

export interface PortfolioSlice {
  readonly kind: InvestmentKind;
  readonly value: Money;
  /** Participación en puntos básicos; las partes suman 10 000. */
  readonly shareBp: number;
}

export interface PortfolioSummary {
  readonly invested: Money;
  readonly value: Money;
  readonly gain: Money;
  readonly returnBp: number | null;
  /** Rentabilidad anual con los días promedio ponderados por lo invertido. */
  readonly annualBp: number | null;
  readonly allocation: readonly PortfolioSlice[];
}

/** Resumen del portafolio en una moneda; las posiciones en otra moneda se ignoran. */
export function portfolioSummary(
  positions: readonly Position[],
  currency: CurrencyCode,
  today: CivilDate,
): PortfolioSummary {
  const mine = positions.filter((p) => p.invested.currencyCode === currency);
  const zero = Money.zero(currency);
  let invested = zero;
  let value = zero;
  let weightedDays = 0n;
  const byKind = new Map<InvestmentKind, Money>();
  for (const p of mine) {
    const v = positionValue(p);
    invested = invested.add(p.invested);
    value = value.add(v);
    const days = BigInt(Math.max(0, daysBetween(p.openedOn, today)));
    weightedDays += days * (p.invested.amountMinor > 0n ? p.invested.amountMinor : 0n);
    byKind.set(p.kind, (byKind.get(p.kind) ?? zero).add(v));
  }
  const days = invested.amountMinor > 0n ? Number(weightedDays / invested.amountMinor) : 0;
  const kinds = INVESTMENT_KINDS.filter((k) => (byKind.get(k)?.amountMinor ?? 0n) > 0n);
  const shares =
    value.amountMinor > 0n
      ? Money.ofMinor(10_000n, currency).allocate(
          kinds.map((k) => (byKind.get(k) ?? zero).amountMinor),
        )
      : [];
  return {
    invested,
    value,
    gain: value.subtract(invested),
    returnBp: simpleReturnBp(invested, value),
    annualBp: annualizedReturnBp(invested, value, days),
    allocation: kinds.map((kind, i) => ({
      kind,
      value: byKind.get(kind) ?? zero,
      shareBp: Number(shares[i]?.amountMinor ?? 0n),
    })),
  };
}

/** Retención en la fuente sobre rendimientos financieros de personas naturales: 4 %. */
export const CDT_WITHHOLDING_BP = 400;

export interface CdtInput {
  readonly amount: Money;
  /** Tasa efectiva anual en puntos básicos. */
  readonly annualRateBp: number;
  /** Plazo en días (los bancos ofrecen 30 a 1 800). */
  readonly days: number;
  readonly withholdingBp?: number;
}

export interface CdtResult {
  readonly interest: Money;
  readonly withholding: Money;
  readonly net: Money;
  /** Lo que se recibe al vencimiento: capital + intereses − retención. */
  readonly atMaturity: Money;
}

const bpFactor = (bp: number) => (bp / 10_000).toFixed(4);

/** Simula un CDT a tasa E.A. con intereses al vencimiento. `null` si los datos no sirven. */
export function simulateCdt(input: CdtInput): CdtResult | null {
  const { amount, annualRateBp, days } = input;
  const withholdingBp = input.withholdingBp ?? CDT_WITHHOLDING_BP;
  if (
    amount.amountMinor <= 0n ||
    !Number.isInteger(annualRateBp) ||
    annualRateBp < 0 ||
    annualRateBp > 10_000 ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 3_650
  ) {
    return null;
  }
  const factor = ((1 + annualRateBp / 10_000) ** (days / 365) - 1).toFixed(9);
  const interest = amount.multiply(factor, "half-even");
  const withholding = interest.multiply(bpFactor(withholdingBp), "half-up");
  const net = interest.subtract(withholding);
  return { interest, withholding, net, atMaturity: amount.add(net) };
}
