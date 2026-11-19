import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { openDeviceDatabase } from "./database";
import type { SqlConnection } from "./sql";

export type LocalDatabaseState =
  | { status: "opening" }
  | { status: "ready"; db: SqlConnection }
  | { status: "error"; error: Error };

const LocalDatabaseContext = createContext<LocalDatabaseState>({ status: "opening" });

/** Abre la base cifrada al iniciar la app y la comparte con las pantallas. */
export function LocalDatabaseProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LocalDatabaseState>({ status: "opening" });

  useEffect(() => {
    let active = true;
    let close: (() => Promise<void>) | undefined;
    openDeviceDatabase().then(
      (local) => {
        close = local.close;
        if (active) setState({ status: "ready", db: local.db });
        else void local.close();
      },
      (error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        if (active) setState({ status: "error", error: err });
      },
    );
    return () => {
      active = false;
      void close?.();
    };
  }, []);

  return <LocalDatabaseContext.Provider value={state}>{children}</LocalDatabaseContext.Provider>;
}

export const useLocalDatabase = (): LocalDatabaseState => useContext(LocalDatabaseContext);
