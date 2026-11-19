export type Period = "thisMonth" | "lastMonth" | "all";

/** Rango [desde, hasta) del periodo en el calendario del teléfono. */
export function periodRange(period: Period, now: Date): { from: Date | null; to: Date | null } {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === "thisMonth") return { from: new Date(y, m, 1), to: new Date(y, m + 1, 1) };
  if (period === "lastMonth") return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1) };
  return { from: null, to: null };
}
