import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { newId } from "../data/ids";
import { useLocalDatabase } from "../data/provider";
import { completeOnboarding, isOnboarded, type OnboardingInput } from "./onboarding";

/** `unavailable`: no hay base local (web) y el onboarding no aplica. */
export type OnboardingStatus = "checking" | "pending" | "done" | "unavailable";

interface Onboarding {
  readonly status: OnboardingStatus;
  complete(input: OnboardingInput): Promise<void>;
}

const OnboardingContext = createContext<Onboarding | null>(null);

export function OnboardingProvider({ children }: { readonly children: ReactNode }) {
  const database = useLocalDatabase();
  const [status, setStatus] = useState<OnboardingStatus>("checking");

  useEffect(() => {
    if (database.status === "error") setStatus("unavailable");
    if (database.status !== "ready") return;
    let active = true;
    void isOnboarded(database.db).then((done) => {
      if (active) setStatus(done ? "done" : "pending");
    });
    return () => {
      active = false;
    };
  }, [database]);

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
