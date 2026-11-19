import { Money } from "@lukas/domain";

/**
 * Lee un saldo escrito por la persona en pesos: "150.000", "150000" o "-20.000".
 * Los puntos son separadores de miles. Devuelve `null` si está vacío y `undefined` si es inválido.
 */
export function parsePesos(text: string): Money | null | undefined {
  const clean = text.replace(/\./g, "").replace(/\s/g, "");
  if (clean === "") return null;
  if (!/^-?\d+$/.test(clean)) return undefined;
  const res = Money.parse(clean, "COP");
  return res.ok ? res.value : undefined;
}
