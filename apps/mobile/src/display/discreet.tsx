import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { sqlitePreferences } from "../data/preferences";
import { useLocalDatabase } from "../data/provider";

interface Discreet {
  /** Oculta los montos en toda la app (p. ej. en el bus o mostrando la pantalla). */
  readonly discreet: boolean;
  setDiscreet(on: boolean): void;
}

const DiscreetContext = createContext<Discreet>({ discreet: false, setDiscreet: () => undefined });

export function DiscreetProvider({ children }: { readonly children: ReactNode }) {
  const database = useLocalDatabase();
  const [discreet, setState] = useState(false);

  useEffect(() => {
    if (database.status !== "ready") return;
    void sqlitePreferences(database.db)
      .get("display.discreet")
      .then((v) => setState(v === "1"));
  }, [database]);

  const setDiscreet = useCallback(
    (on: boolean) => {
      setState(on);
      if (database.status === "ready") {
        void sqlitePreferences(database.db).set("display.discreet", on ? "1" : "0");
      }
    },
    [database],
  );

  const value = useMemo(() => ({ discreet, setDiscreet }), [discreet, setDiscreet]);
  return <DiscreetContext.Provider value={value}>{children}</DiscreetContext.Provider>;
}

export const useDiscreet = (): Discreet => useContext(DiscreetContext);
