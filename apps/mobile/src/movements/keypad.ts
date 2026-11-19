import { Money } from "@lukas/domain";

export type KeypadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "000" | "back";

/** Hasta billones de pesos: de sobra para un gasto y lejos del límite de 2^53 de la base. */
const MAX_DIGITS = 13;

/**
 * Teclado propio en pesos enteros: sin decimales ni separadores que escribir, que es lo que más
 * tiempo toma en el teclado del sistema. El estado son solo los dígitos.
 */
export function pressKey(digits: string, key: KeypadKey): string {
  if (key === "back") return digits.slice(0, -1);
  const next = (digits + key).replace(/^0+/, "");
  return next.length > MAX_DIGITS ? digits : next;
}

export function keypadAmount(digits: string): Money {
  return Money.ofMinor(BigInt(digits || "0") * 100n, "COP");
}
