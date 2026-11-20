/** Lo mínimo de `window` que se usa: así se prueba sin navegador. */
export interface UnloadTarget {
  addEventListener(
    type: "beforeunload",
    listener: (event: { preventDefault(): void }) => void,
  ): void;
  removeEventListener(
    type: "beforeunload",
    listener: (event: { preventDefault(): void }) => void,
  ): void;
}

export interface FlushDeps {
  /** Registros con cambios sin subir. */
  pending(): Promise<number>;
  sync(): void;
  target: UnloadTarget;
  every: number;
  timers?: {
    set(fn: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
}

/** Cada cuánto se revisa la cola en la web. La consulta es local y barata. */
export const WEB_FLUSH_MS = 3000;

/**
 * En la web la base vive en memoria: lo que no se suba se pierde al cerrar la pestaña. Se revisa la
 * cola a menudo y se sube en cuanto hay algo; si aún queda algo pendiente al cerrar, el navegador
 * pregunta antes de salir.
 */
export function startWebFlush(deps: FlushDeps): () => void {
  const timers = deps.timers ?? {
    set: (fn: () => void, ms: number) => setInterval(fn, ms),
    clear: (h: unknown) => clearInterval(h as ReturnType<typeof setInterval>),
  };
  let waiting = 0;
  const tick = async () => {
    try {
      waiting = await deps.pending();
      if (waiting > 0) deps.sync();
    } catch {
      // La base se está cerrando: la siguiente vuelta lo intenta otra vez.
    }
  };
  const onUnload = (event: { preventDefault(): void }) => {
    if (waiting > 0) event.preventDefault();
  };
  const handle = timers.set(() => void tick(), deps.every);
  deps.target.addEventListener("beforeunload", onUnload);
  void tick();
  return () => {
    timers.clear(handle);
    deps.target.removeEventListener("beforeunload", onUnload);
  };
}
