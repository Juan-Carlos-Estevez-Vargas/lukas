import { Money, type Position } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { createConnection } from "../data/connection";
import { migrate } from "../data/migrations";
import { nodeSqlite } from "../data/node-sqlite.test-helper";
import { sqlitePreferences } from "../data/preferences";
import { LOCAL_MIGRATIONS } from "../data/schema";
import {
  formatPercentBp,
  listPositions,
  parseCivil,
  parseUnitPrice,
  parseUnits,
  positionProblem,
  removePosition,
  savePosition,
} from "./investments";

const cop = (pesos: bigint) => Money.ofMinor(pesos * 100n, "COP");
const position = (over: Partial<Position> = {}): Position => ({
  id: "p1",
  name: " CDT Bancolombia ",
  kind: "cdt",
  units: "1",
  unitPrice: cop(5_200_000n),
  invested: cop(5_000_000n),
  openedOn: { year: 2026, month: 1, day: 15 },
  ...over,
});

async function db() {
  const node = nodeSqlite();
  const conn = createConnection(node);
  await migrate(conn, LOCAL_MIGRATIONS);
  return conn;
}

describe("posiciones de inversión", () => {
  it("guarda, actualiza y borra", async () => {
    const conn = await db();
    expect(await listPositions(conn)).toEqual([]);
    await savePosition(conn, position());
    await savePosition(
      conn,
      position({ id: "p2", name: "Bitcoin", kind: "crypto", units: "0.0035" }),
    );
    const [first] = await listPositions(conn);
    expect(first?.name).toBe("CDT Bancolombia");
    expect(first?.unitPrice).toEqual(cop(5_200_000n));
    await savePosition(conn, position({ unitPrice: cop(5_300_000n) }));
    const all = await listPositions(conn);
    expect(all.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(all[0]?.unitPrice).toEqual(cop(5_300_000n));
    expect(all[1]?.units).toBe("0.0035");
    await removePosition(conn, "p1");
    expect((await listPositions(conn)).map((p) => p.id)).toEqual(["p2"]);
    await expect(savePosition(conn, position({ name: "" }))).rejects.toThrow(RangeError);
  });

  it("ignora datos dañados", async () => {
    const conn = await db();
    const prefs = sqlitePreferences(conn);
    await prefs.set("investments.positions", "no es json");
    expect(await listPositions(conn)).toEqual([]);
    await prefs.set("investments.positions", "{}");
    expect(await listPositions(conn)).toEqual([]);
    await prefs.set(
      "investments.positions",
      JSON.stringify([
        {
          id: "x",
          name: "x",
          kind: "casa",
          units: "1",
          currency: "COP",
          unitPriceMinor: "1",
          investedMinor: "1",
          openedOn: "2026-01-01",
        },
        {
          id: "y",
          name: "y",
          kind: "fund",
          units: "1",
          currency: "COP",
          unitPriceMinor: "1",
          investedMinor: "1",
          openedOn: "2026-02-30",
        },
        {
          id: "z",
          name: "z",
          kind: "fund",
          units: "1",
          currency: "COP",
          unitPriceMinor: "1",
          investedMinor: "1",
          openedOn: "2026-02-03",
        },
      ]),
    );
    expect((await listPositions(conn)).map((p) => p.id)).toEqual(["z"]);
  });

  it("valida lo que escribe la persona", () => {
    expect([
      formatPercentBp(1428),
      formatPercentBp(-150),
      formatPercentBp(1000),
      formatPercentBp(5),
    ]).toEqual(["14,28 %", "-1,5 %", "10 %", "0,05 %"]);
    expect(parseUnits("12,5")).toBe("12.5");
    expect(parseUnits("1.234,5")).toBe("1234.5");
    expect(parseUnits("0.0035")).toBe("0.0035");
    expect(parseUnits("0")).toBeNull();
    expect(parseUnits("abc")).toBeNull();
    expect(parseUnitPrice("12.345,67")).toEqual(Money.ofMinor(1_234_567n, "COP"));
    expect(parseUnitPrice("5.200.000")).toEqual(cop(5_200_000n));
    expect(parseUnitPrice("1,234")).toBeNull();
    expect(parseCivil("2026-02-29")).toBeNull();
    expect(parseCivil("2026-02-28")).toEqual({ year: 2026, month: 2, day: 28 });
    expect(positionProblem(position())).toBeNull();
    expect(positionProblem(position({ units: "0" }))).toBe("units");
    expect(positionProblem(position({ unitPrice: cop(-1n) }))).toBe("price");
    expect(positionProblem(position({ invested: cop(0n) }))).toBe("invested");
    expect(positionProblem(position({ invested: Money.ofMinor(1n, "USD") }))).toBe("currency");
  });
});
