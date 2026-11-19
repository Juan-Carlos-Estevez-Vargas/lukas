import { describe, expect, it } from "vitest";
import { hitBar, hitGroup, hitRow, layoutBars, layoutHBars } from "./bars";
import { layoutLine, linePath, nearestPoint } from "./line";
import { niceMax, ratio, ticks } from "./scale";

describe("escalas", () => {
  it("redondea el máximo a 1, 2 o 5 × 10ⁿ", () => {
    expect(niceMax(0n)).toBe(0n);
    expect(niceMax(7n)).toBe(10n);
    expect(niceMax(10n)).toBe(10n);
    expect(niceMax(130_000_00n)).toBe(200_000_00n);
    expect(niceMax(4_100_000_00n)).toBe(5_000_000_00n);
    expect(niceMax(9_999_999_999_999_99n)).toBe(10_000_000_000_000_00n);
  });

  it("reparte las marcas del eje desde cero", () => {
    expect(ticks(200n)).toEqual([0n, 50n, 100n, 150n, 200n]);
    expect(ticks(0n)).toEqual([0n]);
  });

  it("la proporción se mantiene en 0…1 y no pierde precisión con montos grandes", () => {
    expect(ratio(50n, 200n)).toBe(0.25);
    expect(ratio(-5n, 200n)).toBe(0);
    expect(ratio(500n, 200n)).toBe(1);
    expect(ratio(5n, 0n)).toBe(0);
    expect(ratio(9_007_199_254_740_993n, 18_014_398_509_481_986n)).toBe(0.5);
  });
});

describe("barras", () => {
  const flow = [
    { key: "income", values: [300n, 0n, 100n] },
    { key: "expense", values: [200n, 50n, 400n] },
  ];

  it("ubica una columna por grupo y una barra por serie, con el alto proporcional", () => {
    const layout = layoutBars(flow, { width: 300, height: 100, groupGap: 0.2 });
    expect(layout.groups).toBe(3);
    expect(layout.max).toBe(500n);
    expect(layout.bars).toHaveLength(6);
    const first = layout.bars[0];
    expect(first).toMatchObject({
      group: 0,
      series: 0,
      value: 300n,
      x: 10,
      width: 40,
      height: 60,
      y: 40,
    });
    expect(layout.bars[1]).toMatchObject({ x: 50, height: 40 });
    expect(layout.bars[2]).toMatchObject({ group: 1, value: 0n, height: 0, y: 100 });
  });

  it("una barra con valor nunca es invisible", () => {
    const layout = layoutBars([{ key: "a", values: [1n, 1_000_000n] }], {
      width: 100,
      height: 100,
    });
    expect(layout.bars[0]?.height).toBe(2);
  });

  it("sin datos no dibuja nada", () => {
    expect(layoutBars([], { width: 100, height: 100 })).toMatchObject({ groups: 0, bars: [] });
  });

  it("sabe qué grupo se tocó", () => {
    const layout = layoutBars(flow, { width: 300, height: 100 });
    expect(hitGroup(layout, 0)).toBe(0);
    expect(hitGroup(layout, 150)).toBe(1);
    expect(hitGroup(layout, 299.9)).toBe(2);
    expect(hitGroup(layout, 300)).toBeNull();
    expect(hitGroup(layout, -1)).toBeNull();
    expect(hitGroup(layoutBars([], { width: 10, height: 10 }), 1)).toBeNull();
  });

  it("distingue la serie tocada dentro del grupo", () => {
    const layout = layoutBars(flow, { width: 300, height: 100, groupGap: 0.2 });
    expect(hitBar(layout, 20)).toEqual({ group: 0, series: 0 });
    expect(hitBar(layout, 60)).toEqual({ group: 0, series: 1 });
    expect(hitBar(layout, 5)).toEqual({ group: 0, series: null });
    expect(hitBar(layout, 400)).toBeNull();
  });

  it("barras horizontales proporcionales al mayor, y toque por fila", () => {
    const rows = layoutHBars([400n, 100n, 0n], { width: 200, rowHeight: 20, gap: 10 });
    expect(rows.map((r) => r.width)).toEqual([200, 50, 0]);
    expect(rows.map((r) => r.y)).toEqual([0, 30, 60]);
    expect(hitRow(rows, 35)).toBe(1);
    expect(hitRow(rows, 25)).toBeNull();
  });
});

describe("línea", () => {
  it("incluye el cero aunque todo sea positivo", () => {
    const line = layoutLine([100n, 200n], { width: 100, height: 100 });
    expect(line.min).toBe(0n);
    expect(line.max).toBe(200n);
    expect(line.points).toEqual([
      { x: 0, y: 50 },
      { x: 100, y: 0 },
    ]);
    expect(line.zeroY).toBe(100);
  });

  it("con valores negativos el cero queda en medio", () => {
    const line = layoutLine([-100n, 100n], { width: 10, height: 100 });
    expect(line.zeroY).toBe(50);
    expect(line.points.map((p) => p.y)).toEqual([100, 0]);
  });

  it("un solo punto va centrado y sin datos no hay puntos", () => {
    expect(layoutLine([5n], { width: 80, height: 10 }).points[0]?.x).toBe(40);
    const empty = layoutLine([], { width: 80, height: 10 });
    expect(empty.points).toEqual([]);
    expect(empty.zeroY).toBe(10);
    expect(nearestPoint(empty, 3)).toBeNull();
  });

  it("traza el camino SVG y encuentra el punto más cercano", () => {
    const line = layoutLine([0n, 50n, 100n], { width: 200, height: 100 });
    expect(linePath(line.points)).toBe("M 0.0 100.0 L 100.0 50.0 L 200.0 0.0");
    expect(nearestPoint(line, 140)).toBe(1);
    expect(nearestPoint(line, 160)).toBe(2);
  });
});
