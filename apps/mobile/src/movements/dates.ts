/** Día elegido para el movimiento: 0 es hoy, 1 ayer… Nunca en el futuro. */
export function occurredAtFor(daysAgo: number, now: Date): Date {
  if (daysAgo <= 0) return now;
  // Días pasados a mediodía: lejos de la medianoche para que ningún cambio de zona lo mueva.
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 12);
}
