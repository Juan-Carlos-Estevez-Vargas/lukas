import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { e2eMode } from "../config";
import { newId } from "../data/ids";
import { useLocalDatabase } from "../data/provider";
import { useSync } from "../sync/use-sync";
import { completeOnboarding, hasAccounts, isOnboarded, type OnboardingInput } from "./onboarding";

/**
 * `unavailable`: no se pudo abrir la base local. `offline`: en la web, el primer sync falló y no se
 * sabe si el usuario ya tiene datos (no se ofrece el onboarding para no duplicar cuentas).
 */
export type OnboardingStatus = "checking" | "pending" | "done" | "unavailable" | "offline";

interface Onboarding {
  readonly status: OnboardingStatus;
  complete(input: OnboardingInput): Promise<void>;
}

const OnboardingContext = createContext<Onboarding | null>(null);

export function OnboardingProvider({ children }: { readonly children: ReactNode }) {
  const database = useLocalDatabase();
  const sync = useSync();
  const [status, setStatus] = useState<OnboardingStatus>("checking");
  // En la web la base empieza vacía: hay que esperar al primer sync antes de decidir. En las
  // pruebas E2E no hay servidor, así que no se espera.
  const firstSync =
    database.status !== "ready" || database.persistent || e2eMode
      ? "n/a"
      : sync.status?.lastSyncedAt
        ? "ok"
        : sync.failed
          ? "failed"
          : "waiting";

  useEffect(() => {
    if (database.status === "error") setStatus("unavailable");
    if (database.status !== "ready") return;
    if (firstSync === "waiting" || firstSync === "failed") {
      setStatus(firstSync === "failed" ? "offline" : "checking");
      return;
    }
    let active = true;
    const check = database.persistent ? isOnboarded : hasAccounts;
    void check(database.db).then((done) => {
      if (active) setStatus(done ? "done" : "pending");
    });
    return () => {
      active = false;
    };
  }, [database, firstSync]);

  const complete = useCallback(
    async (input: OnboardingInput) => {
      if (database.status !== "ready") throw new Error("La base local no está lista");
      await completeOnboarding(database.db, input, { newId, now: () => new Date() });
      setStatus("done");
    },
    [database],
  );

  const value = useMemo(() => ({ status, complete }), [status, complete]);
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): Onboarding {
  const value = useContext(OnboardingContext);
  if (!value) throw new Error("useOnboarding fuera de OnboardingProvider");
  return value;
}
