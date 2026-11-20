/**
 * Escalas sobre montos en unidades menores (`bigint`). Los píxeles sí son `number`: un monto solo se
 * vuelve número al dividirlo por el máximo, nunca para sumar plata.
 */

const STEPS = [1n, 2n, 5n, 10n] as const;

/** Máximo "redondo" (1, 2 o 5 × 10ⁿ) mayor o igual que `value`. Cero si no hay datos. */
export function niceMax(value: bigint): bigint {
  if (value <= 0n) return 0n;
  let power = 1n;
  while (power * 10n <= value) power *= 10n;
  for (const step of STEPS) if (step * power >= value) return step * power;
  return 10n * power;
}

/** Marcas del eje: de cero al máximo redondo, en `count` partes iguales. */
export function ticks(max: bigint, count = 4): bigint[] {
  if (max <= 0n || count < 1) return [0n];
  return Array.from({ length: count + 1 }, (_, i) => (max * BigInt(i)) / BigInt(count));
}

/** Fracción 0…1 de `value` sobre `max`, sin perder precisión con montos grandes. */
export function ratio(value: bigint, max: bigint): number {
  if (max <= 0n) return 0;
  const clamped = value < 0n ? 0n : value > max ? max : value;
  return Number((clamped * 1_000_000n) / max) / 1_000_000;
}
