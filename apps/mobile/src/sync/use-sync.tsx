import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { useSession } from "../auth/session";
import { apiUrl, e2eMode } from "../config";
import { useLocalDatabase } from "../data/provider";
import { createSyncApi } from "./client";
import { type SyncStatus, syncNow, syncStatus } from "./sync";

interface SyncState {
  readonly status: SyncStatus | null;
  readonly syncing: boolean;
  /** Falló la última sincronización (sin red, servidor caído…). Los datos siguen en el teléfono. */
  readonly failed: boolean;
  /** Cambia cuando llegan datos de otro dispositivo: las pantallas lo usan para recargar. */
  readonly version: number;
  sync(): void;
}

const SyncContext = createContext<SyncState>({
  status: null,
  syncing: false,
  failed: false,
  version: 0,
  sync: () => undefined,
});

/**
 * Sincroniza al abrir la app, al volver a ella y a pedido (Ajustes). Sin red no pasa nada: la
 * cola espera en SQLite hasta la próxima vez.
 */
export function SyncProvider({ children }: { readonly children: ReactNode }) {
  const database = useLocalDatabase();
  const { state, client } = useSession();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const running = useRef(false);
  // Usuario de la sesión, guardado junto al token que lo resolvió.
  const me = useRef<{ token: string; userId: string } | null>(null);
  const token = state.status === "signedIn" ? state.token : null;

  const sync = useCallback(() => {
    if (database.status !== "ready" || !token || e2eMode || running.current) return;
    running.current = true;
    setSyncing(true);
    void (async () => {
      try {
        if (me.current?.token !== token) {
          const res = await client.me(token);
          if (!res.ok || !res.value) throw new Error("Sin sesión");
          me.current = { token, userId: res.value.userId };
        }
        const result = await syncNow(database.db, createSyncApi(apiUrl, token), me.current.userId);
        setFailed(false);
        if (result.pulled > 0 || result.conflicts > 0) setVersion((v) => v + 1);
      } catch {
        setFailed(true);
      } finally {
        setStatus(await syncStatus(database.db).catch(() => null));
        running.current = false;
        setSyncing(false);
      }
    })();
  }, [database, token, client]);

  useEffect(() => {
    sync();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") sync();
    });
    return () => sub.remove();
  }, [sync]);

  const value = useMemo(
    () => ({ status, syncing, failed, version, sync }),
    [status, syncing, failed, version, sync],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export const useSync = (): SyncState => useContext(SyncContext);
