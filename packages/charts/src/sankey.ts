import { ratio } from "./scale";

export interface SankeyFlow {
  readonly key: string;
  /** Unidades menores; los valores en cero o negativos no se dibujan. */
  readonly value: bigint;
}

export interface SankeyNode {
  readonly key: string;
  /** 0: de dónde entra la plata, 1: el total del mes, 2: a dónde se fue. */
  readonly column: 0 | 1 | 2;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly value: bigint;
}

export interface SankeyLink {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
  /** Cinta cerrada en formato de trazo SVG. */
  readonly path: string;
}

export interface SankeyLayout {
  readonly nodes: readonly SankeyNode[];
  readonly links: readonly SankeyLink[];
  readonly total: bigint;
}

/** Clave del nodo del medio, el total que reparte la plata de la izquierda a la derecha. */
export const SANKEY_TOTAL = "total";

/** Cinta de grosor `h` desde (x0, y0) hasta (x1, y1), con curvas suaves. */
export function ribbon(x0: number, y0: number, x1: number, y1: number, h: number): string {
  const xm = (x0 + x1) / 2;
  const f = (n: number) => n.toFixed(1);
  return [
    `M ${f(x0)} ${f(y0)}`,
    `C ${f(xm)} ${f(y0)} ${f(xm)} ${f(y1)} ${f(x1)} ${f(y1)}`,
    `L ${f(x1)} ${f(y1 + h)}`,
    `C ${f(xm)} ${f(y1 + h)} ${f(xm)} ${f(y0 + h)} ${f(x0)} ${f(y0 + h)}`,
    "Z",
  ].join(" ");
}

/**
 * Sankey de tres columnas: entradas → total → salidas. Quien llama equilibra los dos lados (por
 * ejemplo con "Ahorro" o "Déficit"); si no cuadran, el total es el mayor y el lado corto queda
 * más bajo. El alto de cada nodo es proporcional a su valor y los nodos de una columna se separan
 * con `gap`.
 */
export function layoutSankey(
  sources: readonly SankeyFlow[],
  targets: readonly SankeyFlow[],
  options: {
    readonly width: number;
    readonly height: number;
    readonly nodeWidth?: number;
    readonly gap?: number;
  },
): SankeyLayout {
  const { width, height } = options;
  const nodeWidth = options.nodeWidth ?? 10;
  const gap = options.gap ?? 6;
  const left = sources.filter((s) => s.value > 0n);
  const right = targets.filter((t) => t.value > 0n);
  const sum = (list: readonly SankeyFlow[]) => list.reduce((s, f) => s + f.value, 0n);
  const total = sum(left) > sum(right) ? sum(left) : sum(right);
  if (total === 0n || width <= 0 || height <= 0) return { nodes: [], links: [], total: 0n };

  const most = Math.max(left.length, right.length, 1);
  const usable = Math.max(0, height - gap * (most - 1));
  const size = (v: bigint) => ratio(v, total) * usable;
  const xs = [0, (width - nodeWidth) / 2, width - nodeWidth] as const;

  const middle: SankeyNode = {
    key: SANKEY_TOTAL,
    column: 1,
    x: xs[1],
    y: (height - usable) / 2,
    width: nodeWidth,
    height: usable,
    value: total,
  };

  const column = (list: readonly SankeyFlow[], col: 0 | 2): SankeyNode[] => {
    const used = list.reduce((s, f) => s + size(f.value), 0) + gap * (list.length - 1);
    let y = (height - used) / 2;
    return list.map((f) => {
      const node = {
        key: f.key,
        column: col,
        x: xs[col],
        y,
        width: nodeWidth,
        height: size(f.value),
        value: f.value,
      };
      y += node.height + gap;
      return node;
    });
  };
  const leftNodes = column(left, 0);
  const rightNodes = column(right, 2);

  const links: SankeyLink[] = [];
  let into = middle.y;
  for (const n of leftNodes) {
    links.push({
      key: `${n.key}>${SANKEY_TOTAL}`,
      from: n.key,
      to: SANKEY_TOTAL,
      value: n.value,
      path: ribbon(n.x + n.width, n.y, middle.x, into, n.height),
    });
    into += n.height;
  }
  let out = middle.y;
  for (const n of rightNodes) {
    links.push({
      key: `${SANKEY_TOTAL}>${n.key}`,
      from: SANKEY_TOTAL,
      to: n.key,
      value: n.value,
      path: ribbon(middle.x + middle.width, out, n.x, n.y, n.height),
    });
    out += n.height;
  }
  return { nodes: [...leftNodes, middle, ...rightNodes], links, total };
}
