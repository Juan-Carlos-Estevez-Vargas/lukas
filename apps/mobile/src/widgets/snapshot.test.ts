import { Money } from "@lukas/domain";
import { describe, expect, it } from "vitest";
import { availableSnapshot, EMPTY_SNAPSHOT, parseSnapshot, quickEntryUri } from "./snapshot";

const cop = (pesos: bigint) => Money.ofMinor(pesos * 100n, "COP");
const opts = { locale: "es" as const, label: "Disponible", hint: "abre" };

describe("widgets", () => {
  it("muestra el disponible y lo oculta con PIN o modo discreto", () => {
    expect(availableSnapshot(cop(1_250_000n), { ...opts, hidden: false })).toEqual({
      label: "Disponible",
      amount: "$\u00a01.250.000",
      hint: "abre",
      negative: false,
    });
    expect(availableSnapshot(cop(-5n), { ...opts, hidden: false }).negative).toBe(true);
    const hidden = availableSnapshot(cop(-5n), { ...opts, hidden: true });
    expect(hidden.amount).toBe("$\u00a0••••");
    expect(hidden.negative).toBe(false);
  });

  it("enlaces al registro rápido", () => {
    expect(quickEntryUri("expense")).toBe("lukas://movement/new?kind=expense");
    expect(quickEntryUri("expense", "default.mercado")).toBe(
      "lukas://movement/new?kind=expense&category=default.mercado",
    );
  });

  it("lee lo guardado y descarta basura", () => {
    const s = availableSnapshot(cop(1n), { ...opts, hidden: false });
    expect(parseSnapshot(JSON.stringify(s))).toEqual(s);
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot("{")).toBeNull();
    expect(parseSnapshot("1")).toBeNull();
    expect(parseSnapshot(JSON.stringify({ label: 1 }))).toBeNull();
    expect(EMPTY_SNAPSHOT("a", "b").amount).toBe("—");
  });
});
