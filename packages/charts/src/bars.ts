import { niceMax, ratio, ticks } from "./scale";

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Una serie (p. ej. ingresos) con un valor no negativo por grupo (p. ej. por mes). */
export interface Series {
  readonly key: string;
  readonly values: readonly bigint[];
}

export interface Bar extends Box {
  readonly group: number;
  readonly series: number;
  readonly value: bigint;
}

export interface BarLayout {
  readonly width: number;
  readonly height: number;
  readonly groups: number;
  /** Ancho de cada grupo, contando su espacio: sirve para saber qué grupo se tocó. */
  readonly groupWidth: number;
  readonly max: bigint;
  readonly ticks: readonly bigint[];
  readonly bars: readonly Bar[];
}

export interface BarOptions {
  readonly width: number;
  readonly height: number;
  /** Fracción del ancho del grupo que queda libre entre grupos (0…1). */
  readonly groupGap?: number;
  /** Alto mínimo de una barra con valor, para que no desaparezca al lado de una muy grande. */
  readonly minBar?: number;
}

/** Barras verticales agrupadas: una columna por grupo y, dentro, una barra por serie. */
export function layoutBars(series: readonly Series[], options: BarOptions): BarLayout {
  const { width, height, groupGap = 0.3, minBar = 2 } = options;
  const groups = Math.max(0, ...series.map((s) => s.values.length));
  const top = series.flatMap((s) => s.values).reduce((m, v) => (v > m ? v : m), 0n);
  const max = niceMax(top);
  const groupWidth = groups === 0 ? 0 : width / groups;
  const inner = groupWidth * (1 - groupGap);
  const barWidth = series.length === 0 ? 0 : inner / series.length;
  const bars: Bar[] = [];
  for (let g = 0; g < groups; g++) {
    const left = g * groupWidth + (groupWidth - inner) / 2;
    series.forEach((s, i) => {
      const value = s.values[g] ?? 0n;
      const h = value > 0n ? Math.max(minBar, ratio(value, max) * height) : 0;
      bars.push({
        group: g,
        series: i,
        value,
        x: left + i * barWidth,
        y: height - h,
        width: barWidth,
        height: h,
      });
    });
  }
  return { width, height, groups, groupWidth, max, ticks: ticks(max), bars };
}

/** Grupo bajo la coordenada `x` (toque o clic), o `null` si cae fuera del gráfico. */
export function hitGroup(layout: BarLayout, x: number): number | null {
  if (layout.groups === 0 || x < 0 || x >= layout.width) return null;
  return Math.min(layout.groups - 1, Math.floor(x / layout.groupWidth));
}

/**
 * Barra exacta bajo `x`: el grupo y, si el toque cae sobre una barra (no en el espacio entre
 * grupos), su serie. Así tocar "gastos de octubre" no es lo mismo que tocar "ingresos de octubre".
 */
export function hitBar(
  layout: BarLayout,
  x: number,
): { group: number; series: number | null } | null {
  const group = hitGroup(layout, x);
  if (group === null) return null;
  const bar = layout.bars.find((b) => b.group === group && x >= b.x && x < b.x + b.width);
  return { group, series: bar ? bar.series : null };
}

export interface HBar extends Box {
  readonly index: number;
  readonly value: bigint;
}

/** Barras horizontales (una por fila), proporcionales al mayor valor. Para "en qué se va". */
export function layoutHBars(
  values: readonly bigint[],
  options: { readonly width: number; readonly rowHeight: number; readonly gap?: number },
): HBar[] {
  const { width, rowHeight, gap = 8 } = options;
  const top = values.reduce((m, v) => (v > m ? v : m), 0n);
  return values.map((value, index) => ({
    index,
    value,
    x: 0,
    y: index * (rowHeight + gap),
    width: value > 0n ? Math.max(2, ratio(value, top) * width) : 0,
    height: rowHeight,
  }));
}

/** Fila bajo la coordenada `y`, o `null` si cae en un espacio entre filas o fuera. */
export function hitRow(rows: readonly HBar[], y: number): number | null {
  const row = rows.find((r) => y >= r.y && y < r.y + r.height);
  return row ? row.index : null;
}
