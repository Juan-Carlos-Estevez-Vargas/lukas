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
import { e2eMode } from "../config";
import { useLocalDatabase } from "../data/provider";
import { deviceSecurityModule } from "./device-security";
import {
  applyScreenProtection,
  type RootSignal,
  rootSignals,
  screenshotsAllowed,
  setScreenshotsAllowed,
  shouldBlockScreenshots,
} from "./policy";

interface DeviceSecurityState {
  /** El teléfono puede bloquear capturas (Android con el módulo nativo). */
  readonly available: boolean;
  readonly screenshotsAllowed: boolean;
  setScreenshotsAllowed(allowed: boolean): void;
  /** Señales de root; vacío si no hay o no se pueden leer. */
  readonly rootSignals: readonly RootSignal[];
}

const DeviceSecurityContext = createContext<DeviceSecurityState>({
  available: false,
  screenshotsAllowed: false,
  setScreenshotsAllowed: () => undefined,
  rootSignals: [],
});

/** Bloquea capturas de pantalla (FLAG_SECURE) según la preferencia y detecta root al abrir. */
export function DeviceSecurityProvider({ children }: { readonly children: ReactNode }) {
  const database = useLocalDatabase();
  const [allowed, setAllowed] = useState(false);
  const [signals] = useState(() => rootSignals(deviceSecurityModule));

  // Desde el primer cuadro: la preferencia todavía no se leyó, así que se bloquea por defecto.
  useEffect(() => {
    applyScreenProtection(deviceSecurityModule, shouldBlockScreenshots(allowed, e2eMode));
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        applyScreenProtection(deviceSecurityModule, shouldBlockScreenshots(allowed, e2eMode));
      }
    });
    return () => sub.remove();
  }, [allowed]);

  useEffect(() => {
    if (database.status !== "ready") return;
    void screenshotsAllowed(database.db).then(setAllowed);
  }, [database]);

  const update = useCallback(
    (next: boolean) => {
      setAllowed(next);
      if (database.status === "ready") void setScreenshotsAllowed(database.db, next);
    },
    [database],
  );

  const value = useMemo<DeviceSecurityState>(
    () => ({
      available: deviceSecurityModule !== null,
      screenshotsAllowed: allowed,
      setScreenshotsAllowed: update,
      rootSignals: signals,
    }),
    [allowed, update, signals],
  );
  return <DeviceSecurityContext.Provider value={value}>{children}</DeviceSecurityContext.Provider>;
}

export const useDeviceSecurity = (): DeviceSecurityState => useContext(DeviceSecurityContext);
