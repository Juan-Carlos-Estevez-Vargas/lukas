import { ratio } from "./scale";

export interface CalendarCell {
  /** Día del mes, desde 1. */
  readonly day: number;
  /** Semana dentro de la grilla (fila) y día de la semana, lunes = 0 (columna). */
  readonly row: number;
  readonly column: number;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly value: bigint;
  /** Intensidad de 0 (sin gasto) a `LEVELS` (el día de más gasto). */
  readonly level: number;
}

export interface CalendarLayout {
  readonly cells: readonly CalendarCell[];
  readonly rows: number;
  readonly cellSize: number;
  readonly gap: number;
  readonly height: number;
  readonly max: bigint;
}

/** Escalones de color del mapa de calor (sin contar el cero). */
export const LEVELS = 4;

/** Cuántos días tiene el mes (`month` de 1 a 12). */
export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Calendario del mes como mapa de calor: siete columnas que empiezan el lunes (como en Colombia) y
 * una fila por semana. `values` trae un valor por día, empezando en el día 1; si faltan días valen 0.
 */
export function layoutCalendar(
  year: number,
  month: number,
  values: readonly bigint[],
  options: { readonly width: number; readonly gap?: number },
): CalendarLayout {
  const gap = options.gap ?? 4;
  const days = daysInMonth(year, month);
  const offset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const cellSize = Math.max(0, (options.width - gap * 6) / 7);
  const max = values.slice(0, days).reduce((m, v) => (v > m ? v : m), 0n);
  const rows = Math.ceil((offset + days) / 7);
  const cells = Array.from({ length: days }, (_, i): CalendarCell => {
    const slot = offset + i;
    const row = Math.floor(slot / 7);
    const column = slot % 7;
    const value = values[i] ?? 0n;
    const level = value > 0n ? Math.max(1, Math.ceil(ratio(value, max) * LEVELS)) : 0;
    return {
      day: i + 1,
      row,
      column,
      x: column * (cellSize + gap),
      y: row * (cellSize + gap),
      size: cellSize,
      value,
      level,
    };
  });
  return { cells, rows, cellSize, gap, height: rows * cellSize + (rows - 1) * gap, max };
}

/** Día bajo el punto (x, y), o `null` si cae en un espacio o fuera del mes. */
export function hitCell(layout: CalendarLayout, x: number, y: number): number | null {
  const hit = layout.cells.find(
    (c) => x >= c.x && x <= c.x + c.size && y >= c.y && y <= c.y + c.size,
  );
  return hit?.day ?? null;
}
