import { describe, expect, it } from "vitest";
import {
  getOrCreateDatabaseKey,
  isHexKey,
  KEY_BYTES,
  type KeyStore,
  keyPragma,
  toHex,
} from "./key";

const memoryStore = (initial: string | null = null): KeyStore & { value: string | null } => {
  const store = {
    value: initial,
    read: async () => store.value,
    write: async (v: string) => {
      store.value = v;
    },
  };
  return store;
};

const bytes = (fill: number) => async (n: number) => new Uint8Array(n).fill(fill);

describe("clave de la base local", () => {
  it("crea una clave de 256 bits la primera vez y la guarda", async () => {
    const store = memoryStore();
    const key = await getOrCreateDatabaseKey(store, bytes(0xab));
    expect(key.created).toBe(true);
    expect(key.hex).toBe("ab".repeat(KEY_BYTES));
    expect(store.value).toBe(key.hex);
  });

  it("reutiliza la clave guardada sin generar otra", async () => {
    const saved = "0f".repeat(KEY_BYTES);
    const key = await getOrCreateDatabaseKey(memoryStore(saved), async () => {
      throw new Error("no debería generar");
    });
    expect(key).toEqual({ hex: saved, created: false });
  });

  it("rechaza una clave guardada dañada", async () => {
    await expect(getOrCreateDatabaseKey(memoryStore("xyz"), bytes(1))).rejects.toThrow(/dañada/);
  });

  it("rechaza un generador que no entrega 32 bytes", async () => {
    await expect(
      getOrCreateDatabaseKey(memoryStore(), async () => new Uint8Array(16)),
    ).rejects.toThrow(/32 bytes/);
  });

  it("arma el PRAGMA solo con claves hexadecimales válidas", () => {
    const hex = toHex(new Uint8Array([0, 1, 254, 255]));
    expect(hex).toBe("0001feff");
    expect(isHexKey("a".repeat(64))).toBe(true);
    expect(isHexKey("A".repeat(64))).toBe(false);
    expect(keyPragma("a".repeat(64))).toBe(`PRAGMA key = "x'${"a".repeat(64)}'"`);
    expect(() => keyPragma(`${"a".repeat(63)}'`)).toThrow(/inválida/);
  });
});
