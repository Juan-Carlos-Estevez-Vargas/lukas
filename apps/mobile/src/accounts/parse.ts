import { type CurrencyCode, Money } from "@lukas/domain";

/**
 * Lee un monto escrito por la persona con la costumbre colombiana: punto de miles y coma decimal
 * ("1.234,56"). En pesos solo enteros ("150.000"), que es como se manejan en la práctica.
 * Devuelve `null` si está vacío y `undefined` si es inválido.
 */
export function parseAmount(text: string, currency: CurrencyCode): Money | null | undefined {
  const clean = text.replace(/\./g, "").replace(/\s/g, "");
  if (clean === "") return null;
  const pattern = currency === "COP" ? /^-?\d+$/ : /^-?\d+(,\d+)?$/;
  if (!pattern.test(clean)) return undefined;
  const res = Money.parse(clean.replace(",", "."), currency);
  return res.ok ? res.value : undefined;
}

export const parsePesos = (text: string): Money | null | undefined => parseAmount(text, "COP");
