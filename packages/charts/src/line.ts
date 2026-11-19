import { niceMax, ratio } from "./scale";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface LineLayout {
  readonly points: readonly Point[];
  /** Altura de la línea del cero (el patrimonio puede ser negativo). */
  readonly zeroY: number;
  readonly min: bigint;
  readonly max: bigint;
}

/**
 * Línea con un punto por valor, repartidos a lo ancho. El rango va de min(0, menor) a max(0, mayor),
 * redondeado, para que el cero siempre se vea.
 */
export function layoutLine(
  values: readonly bigint[],
  options: { readonly width: number; readonly height: number },
): LineLayout {
  const { width, height } = options;
  const hi = values.reduce((m, v) => (v > m ? v : m), 0n);
  const lo = values.reduce((m, v) => (v < m ? v : m), 0n);
  const max = niceMax(hi);
  const min = -niceMax(-lo);
  const span = max - min;
  const y = (v: bigint) => height - ratio(v - min, span) * height;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values.map((v, i) => ({ x: values.length > 1 ? i * step : width / 2, y: y(v) }));
  return { points, zeroY: span === 0n ? height : y(0n), min, max };
}

/** Trazo SVG ("M x y L x y …") que entienden Skia (`Path.MakeFromSVGString`) y cualquier SVG. */
export function linePath(points: readonly Point[]): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
}

/** Punto más cercano en horizontal a `x`, o `null` si no hay puntos. */
export function nearestPoint(layout: LineLayout, x: number): number | null {
  if (layout.points.length === 0) return null;
  let best = 0;
  layout.points.forEach((p, i) => {
    if (Math.abs(p.x - x) < Math.abs((layout.points[best]?.x ?? 0) - x)) best = i;
  });
  return best;
}
