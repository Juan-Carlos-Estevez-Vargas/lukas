import { Money } from "./money";

/**
 * Ayuda tributaria para personas naturales en Colombia (FIN-604). Es orientativa: no reemplaza a
 * un contador. Los valores se revisan cada año contra la resolución de la DIAN que fija la UVT.
 */

/** Unidad de Valor Tributario en pesos, por año. */
export const UVT: Readonly<Record<number, bigint>> = {
  2023: 42_412n,
  2024: 47_065n,
  2025: 49_799n,
  2026: 52_374n,
};

export const uvtFor = (year: number): bigint | null => UVT[year] ?? null;

/** Pesos de N UVT del año, como `Money` en COP. */
export const uvtToCop = (uvt: bigint, units: bigint): Money =>
  Money.ofMinor(uvt * units * 100n, "COP");

/**
 * Topes para declarar renta por el año gravable (art. 592 a 594-3 del Estatuto Tributario):
 * basta con superar uno. Patrimonio: más de 4.500 UVT; los demás: 1.400 UVT o más.
 */
export const DECLARATION_LIMITS = {
  grossAssets: 4_500n,
  grossIncome: 1_400n,
  creditCardSpending: 1_400n,
  totalPurchases: 1_400n,
  deposits: 1_400n,
} as const;

export type DeclarationCriterion = keyof typeof DECLARATION_LIMITS;

export interface TaxYearFigures {
  /** Patrimonio bruto al 31 de diciembre (lo que se tiene, sin restar deudas). */
  readonly grossAssets: Money;
  readonly grossIncome: Money;
  readonly creditCardSpending: Money;
  readonly totalPurchases: Money;
  /** Consignaciones, depósitos e inversiones financieras del año. */
  readonly deposits: Money;
}

export interface CriterionCheck {
  readonly criterion: DeclarationCriterion;
  readonly value: Money;
  readonly limit: Money;
  readonly exceeds: boolean;
  /** Qué tan cerca está del tope, de 0 a 100 (se corta en 100). */
  readonly percent: number;
}

export type DeclarationCheck =
  | { readonly ok: true; readonly mustDeclare: boolean; readonly checks: readonly CriterionCheck[] }
  | { readonly ok: false; readonly reason: "unknown_year" };

/** ¿Debe declarar renta por este año gravable? Indica qué tope se supera y qué tan cerca está. */
export function declarationCheck(year: number, figures: TaxYearFigures): DeclarationCheck {
  const uvt = uvtFor(year);
  if (uvt === null) return { ok: false, reason: "unknown_year" };
  const checks = (Object.keys(DECLARATION_LIMITS) as DeclarationCriterion[]).map((criterion) => {
    const limit = uvtToCop(uvt, DECLARATION_LIMITS[criterion]);
    const value = figures[criterion];
    // El patrimonio debe "superar" el tope; los demás basta con "igualarlo".
    const exceeds =
      criterion === "grossAssets" ? value.compare(limit) > 0 : value.compare(limit) >= 0;
    const ratio = limit.amountMinor === 0n ? 0n : (value.amountMinor * 100n) / limit.amountMinor;
    const percent = Number(ratio < 0n ? 0n : ratio > 100n ? 100n : ratio);
    return { criterion, value, limit, exceeds, percent };
  });
  return { ok: true, mustDeclare: checks.some((c) => c.exceeds), checks };
}

/** Tarifa del gravamen a los movimientos financieros: 4 por mil. */
export const GMF_RATE = "0.004";
/** Retiros exentos al mes en la cuenta marcada como exenta: 350 UVT. */
export const GMF_EXEMPT_UVT = 350n;

/**
 * 4×1000 de un mes: sobre lo que sale de cuentas bancarias y billeteras. La cuenta marcada como
 * exenta no paga hasta 350 UVT al mes; lo que pase de ahí sí.
 */
export function gmfForMonth(
  year: number,
  outflows: { readonly exempt: Money; readonly taxed: Money },
): Money | null {
  const uvt = uvtFor(year);
  if (uvt === null) return null;
  const cap = uvtToCop(uvt, GMF_EXEMPT_UVT);
  const overCap = outflows.exempt.compare(cap) > 0 ? outflows.exempt.subtract(cap) : null;
  const base = overCap ? outflows.taxed.add(overCap) : outflows.taxed;
  return base.isNegative() ? Money.zero("COP") : base.multiply(GMF_RATE, "half-up");
}
