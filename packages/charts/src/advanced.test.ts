import { describe, expect, it } from "vitest";
import { daysInMonth, hitCell, LEVELS, layoutCalendar } from "./heatmap";
import { layoutSankey, ribbon, SANKEY_TOTAL } from "./sankey";

describe("sankey", () => {
  const sources = [
    { key: "salario", value: 300n },
    { key: "extra", value: 100n },
  ];
  const targets = [
    { key: "mercado", value: 200n },
    { key: "arriendo", value: 150n },
    { key: "ahorro", value: 50n },
  ];

  it("pone entradas, total y salidas en tres columnas con alto proporcional", () => {
    const layout = layoutSankey(sources, targets, {
      width: 300,
      height: 220,
      gap: 10,
      nodeWidth: 10,
    });
    expect(layout.total).toBe(400n);
    const byKey = new Map(layout.nodes.map((n) => [n.key, n]));
    expect(byKey.get("salario")?.column).toBe(0);
    expect(byKey.get(SANKEY_TOTAL)?.column).toBe(1);
    expect(byKey.get("ahorro")?.column).toBe(2);
    expect(byKey.get(SANKEY_TOTAL)?.x).toBe(145);
    expect(byKey.get("mercado")?.x).toBe(290);
    // Alto útil: 220 − 2 espacios = 200; el mercado es la mitad del total.
    expect(byKey.get("mercado")?.height).toBe(100);
    expect(byKey.get(SANKEY_TOTAL)?.height).toBe(200);
    // La columna de la izquierda (2 nodos, 1 espacio) queda centrada.
    expect(byKey.get("salario")?.y).toBe(5);
    expect(byKey.get("extra")?.y).toBe(165);
  });

  it("une cada entrada con el total y el total con cada salida, apiladas", () => {
    const layout = layoutSankey(sources, targets, { width: 300, height: 220, gap: 10 });
    expect(layout.links.map((l) => l.key)).toEqual([
      "salario>total",
      "extra>total",
      "total>mercado",
      "total>arriendo",
      "total>ahorro",
    ]);
    expect(layout.links[0]?.path.startsWith("M 10.0 5.0 C")).toBe(true);
    expect(
      layout.links[1]?.path.startsWith("M 10.0 165.0 C 77.5 165.0 77.5 160.0 145.0 160.0"),
    ).toBe(true);
  });

  it("ignora valores en cero y no dibuja nada sin datos", () => {
    expect(layoutSankey([{ key: "a", value: 0n }], [], { width: 100, height: 100 }).nodes).toEqual(
      [],
    );
    expect(layoutSankey(sources, targets, { width: 0, height: 100 }).total).toBe(0n);
    const lopsided = layoutSankey(sources, [{ key: "mercado", value: 100n }], {
      width: 100,
      height: 100,
    });
    expect(lopsided.total).toBe(400n);
    expect(lopsided.nodes.find((n) => n.key === "mercado")?.height).toBe(23.5);
  });

  it("la cinta es una figura cerrada con el mismo grosor en ambos extremos", () => {
    expect(ribbon(0, 0, 100, 50, 10)).toBe(
      "M 0.0 0.0 C 50.0 0.0 50.0 50.0 100.0 50.0 L 100.0 60.0 C 50.0 60.0 50.0 10.0 0.0 10.0 Z",
    );
  });
});

describe("mapa de calor", () => {
  it("sabe cuántos días tiene cada mes", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 11)).toBe(30);
  });

  it("arma el calendario desde el lunes, con una fila por semana", () => {
    // Noviembre de 2026 empieza en domingo: el día 1 va en la última columna.
    const layout = layoutCalendar(2026, 11, [], { width: 76, gap: 2 });
    expect(layout.cellSize).toBe(9.142857142857142);
    expect(layout.cells).toHaveLength(30);
    expect(layout.cells[0]).toMatchObject({ day: 1, row: 0, column: 6 });
    expect(layout.cells[1]).toMatchObject({ day: 2, row: 1, column: 0 });
    expect(layout.cells[29]).toMatchObject({ day: 30, row: 5, column: 0 });
    expect(layout.rows).toBe(6);
  });

  it("gradúa la intensidad contra el día de más gasto", () => {
    const values = [0n, 100n, 25n, 1n, 50n];
    const layout = layoutCalendar(2026, 6, values, { width: 70, gap: 0 });
    expect(layout.max).toBe(100n);
    expect(layout.cells.slice(0, 5).map((c) => c.level)).toEqual([0, LEVELS, 1, 1, 2]);
    expect(layout.cells[10]?.level).toBe(0);
  });

  it("encuentra el día tocado y nada en los espacios", () => {
    const layout = layoutCalendar(2026, 6, [], { width: 76, gap: 2 });
    // Junio de 2026 empieza en lunes.
    expect(hitCell(layout, 1, 1)).toBe(1);
    expect(hitCell(layout, 12, 12)).toBe(9);
    expect(hitCell(layout, 9.9, 1)).toBeNull();
    expect(hitCell(layout, 500, 500)).toBeNull();
  });
});
