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
import {
  authenticateWithBiometrics,
  biometricsAvailable,
  lockStore,
  newSalt,
  sha256,
} from "./lock-store";
import { createPinRecord, verifyPin } from "./pin";
import { AUTO_LOCK_MS, parseLockout, registerFailure, shouldLockOnResume, waitMs } from "./policy";

export type LockStatus = "checking" | "off" | "locked" | "unlocked";

export type UnlockResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "wrong" | "wait"; readonly waitMs: number };

interface AppLock {
  readonly status: LockStatus;
  /** La app está en segundo plano o en el selector de apps: se tapa el contenido. */
  readonly covered: boolean;
  readonly biometric: boolean;
  readonly biometricsAvailable: boolean;
  unlockWithPin(pin: string): Promise<UnlockResult>;
  unlockWithBiometrics(prompt: string, cancel: string): Promise<boolean>;
  enable(pin: string, biometric: boolean): Promise<void>;
  disable(): Promise<void>;
}

const AppLockContext = createContext<AppLock | null>(null);

/**
 * Bloqueo con PIN y, si el usuario quiere, huella o rostro. Se activa al abrir la app y al volver
 * tras un minuto en segundo plano. El PIN no cifra la base (eso lo hace la clave del Keystore):
 * evita que alguien con el teléfono desbloqueado vea las finanzas.
 */
export function AppLockProvider({ children }: { readonly children: ReactNode }) {
  const [status, setStatus] = useState<LockStatus>(lockStore.available ? "checking" : "off");
  const [covered, setCovered] = useState(false);
  const [biometric, setBiometric] = useState(false);
  const [canUseBiometrics, setCanUseBiometrics] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!lockStore.available) return;
    let active = true;
    void (async () => {
      const [pin, bio, hasBio] = await Promise.all([
        lockStore.readPin(),
        lockStore.readBiometric(),
        biometricsAvailable(),
      ]);
      if (!active) return;
      setBiometric(bio && hasBio);
      setCanUseBiometrics(hasBio);
      setStatus(pin ? "locked" : "off");
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!lockStore.available) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        setCovered(false);
        if (shouldLockOnResume(backgroundedAt.current, Date.now(), AUTO_LOCK_MS)) {
          setStatus((s) => (s === "unlocked" ? "locked" : s));
        }
        backgroundedAt.current = null;
      } else {
        setCovered(true);
        if (next === "background" && backgroundedAt.current === null) {
          backgroundedAt.current = Date.now();
        }
      }
    });
    return () => sub.remove();
  }, []);

  const unlockWithPin = useCallback(async (pin: string): Promise<UnlockResult> => {
    const lockout = parseLockout(await lockStore.readLockout());
    const now = Date.now();
    const wait = waitMs(lockout, now);
    if (wait > 0) return { ok: false, reason: "wait", waitMs: wait };
    const record = await lockStore.readPin();
    if (record && (await verifyPin(pin, record, sha256))) {
      await lockStore.writeLockout(JSON.stringify({ failures: 0, lockedUntil: 0 }));
      setStatus("unlocked");
      return { ok: true };
    }
    const next = registerFailure(lockout, now);
    await lockStore.writeLockout(JSON.stringify(next));
    return { ok: false, reason: "wrong", waitMs: waitMs(next, now) };
  }, []);

  const unlockWithBiometrics = useCallback(async (prompt: string, cancel: string) => {
    const ok = await authenticateWithBiometrics(prompt, cancel);
    if (ok) setStatus("unlocked");
    return ok;
  }, []);

  const enable = useCallback(async (pin: string, bio: boolean) => {
    await lockStore.writePin(await createPinRecord(pin, await newSalt(), sha256));
    await lockStore.writeBiometric(bio);
    setBiometric(bio);
    setStatus("unlocked");
  }, []);

  const disable = useCallback(async () => {
    await lockStore.clearPin();
    await lockStore.writeBiometric(false);
    setBiometric(false);
    setStatus("off");
  }, []);

  const value = useMemo<AppLock>(
    () => ({
      status,
      covered,
      biometric,
      biometricsAvailable: canUseBiometrics,
      unlockWithPin,
      unlockWithBiometrics,
      enable,
      disable,
    }),
    [
      status,
      covered,
      biometric,
      canUseBiometrics,
      unlockWithPin,
      unlockWithBiometrics,
      enable,
      disable,
    ],
  );

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function useAppLock(): AppLock {
  const value = useContext(AppLockContext);
  if (!value) throw new Error("useAppLock fuera de AppLockProvider");
  return value;
}
