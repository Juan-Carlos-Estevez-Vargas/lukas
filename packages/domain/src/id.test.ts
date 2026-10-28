import { describe, expect, it } from "vitest";
import { isUuidV7, uuidv7, uuidv7Timestamp } from "./id";

describe("uuidv7", () => {
  it("genera UUID v7 válidos con la marca de tiempo", () => {
    const now = 1_761_609_600_000; // 2025-10-28T00:00:00Z
    const id = uuidv7(() => now);
    expect(isUuidV7(id)).toBe(true);
    expect(uuidv7Timestamp(id)).toBe(now);
  });

  it("aplica versión y variante aunque los bytes aleatorios sean todos 1", () => {
    const id = uuidv7(
      () => 0,
      (bytes) => bytes.fill(0xff),
    );
    expect(id).toBe("00000000-0000-7fff-bfff-ffffffffffff");
  });

  it("ordena por fecha de creación", () => {
    const earlier = uuidv7(() => 1_000);
    const later = uuidv7(() => 2_000);
    expect(earlier < later).toBe(true);
  });

  it("no repite identificadores", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });

  it("falla si no hay fuente de aleatoriedad", () => {
    const original = (globalThis as { crypto?: unknown }).crypto;
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      expect(() => uuidv7()).toThrow(/aleatoriedad/);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
    }
  });
});
