import { DomainError } from "./errors";
import { err, ok, type Result } from "./result";

/** Moneda ISO 4217 con la cantidad de decimales de su unidad menor. */
export interface Currency {
  readonly code: string;
  readonly minorUnits: number;
}

/** Monedas soportadas. COP usa 2 decimales según ISO 4217, aunque en la práctica no circulen centavos. */
export const CURRENCIES = {
  COP: { code: "COP", minorUnits: 2 },
  USD: { code: "USD", minorUnits: 2 },
  EUR: { code: "EUR", minorUnits: 2 },
  MXN: { code: "MXN", minorUnits: 2 },
  BRL: { code: "BRL", minorUnits: 2 },
  CLP: { code: "CLP", minorUnits: 0 },
  PEN: { code: "PEN", minorUnits: 2 },
  GBP: { code: "GBP", minorUnits: 2 },
  JPY: { code: "JPY", minorUnits: 0 },
} as const satisfies Record<string, Currency>;

export type CurrencyCode = keyof typeof CURRENCIES;

export const isCurrencyCode = (code: string): code is CurrencyCode =>
  Object.hasOwn(CURRENCIES, code);

export const currencyOf = (code: string): Result<Currency, DomainError> =>
  isCurrencyCode(code)
    ? ok(CURRENCIES[code])
    : err(new DomainError("unsupported_currency", `Moneda no soportada: ${code}`));
