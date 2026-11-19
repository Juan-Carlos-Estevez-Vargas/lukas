import { describe, expect, it } from "vitest";
import { startWebFlush, type UnloadTarget } from "./flush";

function harness(counts: number[]) {
  let tick: (() => void) | undefined;
  let cleared = false;
  let listener: ((e: { preventDefault(): void }) => void) | undefined;
  let syncs = 0;
  const target: UnloadTarget = {
    addEventListener: (_t, l) => {
      listener = l;
    },
    removeEventListener: (_t, l) => {
      if (listener === l) listener = undefined;
    },
  };
  const stop = startWebFlush({
    pending: async () => counts.shift() ?? 0,
    sync: () => {
      syncs += 1;
    },
    target,
    every: 1000,
    timers: {
      set: (fn) => {
        tick = fn;
        return 1;
      },
      clear: () => {
        cleared = true;
      },
    },
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const unload = () => {
    let prevented = false;
    listener?.({ preventDefault: () => (prevented = true) });
    return prevented;
  };
  return { stop, tick: () => tick?.(), flush, unload, syncs: () => syncs, cleared: () => cleared };
}

describe("subida continua en la web", () => {
  it("sube en cuanto hay cambios y no hace nada si la cola está vacía", async () => {
    const h = harness([0, 2, 0]);
    await h.flush();
    expect(h.syncs()).toBe(0);
    h.tick();
    await h.flush();
    expect(h.syncs()).toBe(1);
    h.tick();
    await h.flush();
    expect(h.syncs()).toBe(1);
  });

  it("pide confirmación al cerrar solo si queda algo sin subir", async () => {
    const h = harness([3, 0]);
    await h.flush();
    expect(h.unload()).toBe(true);
    h.tick();
    await h.flush();
    expect(h.unload()).toBe(false);
  });

  it("al detenerse quita el temporizador y el aviso", async () => {
    const h = harness([5]);
    await h.flush();
    h.stop();
    expect(h.cleared()).toBe(true);
    expect(h.unload()).toBe(false);
  });

  it("un error leyendo la cola no rompe nada", async () => {
    let syncs = 0;
    const stop = startWebFlush({
      pending: () => Promise.reject(new Error("cerrada")),
      sync: () => {
        syncs += 1;
      },
      target: { addEventListener: () => undefined, removeEventListener: () => undefined },
      every: 1000,
      timers: { set: () => 1, clear: () => undefined },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(syncs).toBe(0);
    stop();
  });
});
