import { entitlementsOf } from "@lukas/domain";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppState } from "react-native";
import { useSession } from "../auth/session";
import { apiUrl, e2eMode } from "../config";
import { useLocalDatabase } from "../data/provider";
import {
  cachedEntitlements,
  createEntitlementsClient,
  type Entitlements,
  type Feature,
  refreshEntitlements,
} from "./entitlements";

interface EntitlementsState {
  readonly entitlements: Entitlements;
  /** Si el plan incluye la función. Es para mostrar u ocultar; la API vuelve a revisar. */
  can(feature: Feature): boolean;
  /** Vuelve a preguntar a la API (p. ej. después de pagar). */
  refresh(): void;
}

const FREE = entitlementsOf("free");

const EntitlementsContext = createContext<EntitlementsState>({
  entitlements: FREE,
  can: (feature) => FREE.features.includes(feature),
  refresh: () => undefined,
});

const client = createEntitlementsClient(apiUrl);

/** Carga el plan guardado y lo refresca con la API al entrar y cada vez que se vuelve a la app. */
export function EntitlementsProvider({ children }: { readonly children: ReactNode }) {
  const database = useLocalDatabase();
  const { state: session } = useSession();
  const [entitlements, setEntitlements] = useState<Entitlements>(FREE);
  const token = session.status === "signedIn" ? session.token : null;

  const refresh = useCallback(() => {
    if (database.status !== "ready") return;
    const { db } = database;
    void (async () => {
      if (token && !e2eMode) await refreshEntitlements(db, client, token);
      setEntitlements(await cachedEntitlements(db, e2eMode));
    })().catch(() => undefined);
  }, [database, token]);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const value = useMemo<EntitlementsState>(
    () => ({
      entitlements,
      can: (feature) => entitlements.features.includes(feature),
      refresh,
    }),
    [entitlements, refresh],
  );
  return <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>;
}

export const useEntitlements = (): EntitlementsState => useContext(EntitlementsContext);
