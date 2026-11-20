import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { newId } from "../data/ids";
import { useLocalDatabase } from "../data/provider";
import { ingestNotifications } from "./from-notifications";
import { notificationReader } from "./reader";

/** Cambia cada vez que entra algo a la bandeja: las pantallas lo usan para recargar. */
const CaptureContext = createContext(0);

export const useCaptureVersion = (): number => useContext(CaptureContext);

/**
 * Vacía la cola del lector de notificaciones al abrir la app, al volver a ella y cada vez que el
 * lector avisa que llegó algo (con la app abierta, en segundos).
 */
export function CaptureProvider({ children }: { readonly children: ReactNode }) {
  const database = useLocalDatabase();
  const db = database.status === "ready" ? database.db : null;
  const [version, setVersion] = useState(0);
  const running = useRef(false);

  useEffect(() => {
    const reader = notificationReader;
    if (!db || !reader) return;
    const drain = async () => {
      if (running.current) return;
      running.current = true;
      try {
        for (let posted = reader.drain(); posted.length > 0; posted = reader.drain()) {
          const { added } = await ingestNotifications(db, posted, { newId, now: () => new Date() });
          if (added > 0) setVersion((v) => v + 1);
        }
      } finally {
        running.current = false;
      }
    };
    void drain();
    const posted = reader.addListener("onNotification", () => void drain());
    const state = AppState.addEventListener("change", (s) => {
      if (s === "active") void drain();
    });
    return () => {
      posted.remove();
      state.remove();
    };
  }, [db]);

  return <CaptureContext.Provider value={version}>{children}</CaptureContext.Provider>;
}
