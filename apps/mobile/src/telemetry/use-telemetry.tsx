import type { AnalyticsEvent, AnalyticsProperties } from "@lukas/domain";
import Constants from "expo-constants";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";
import { e2eMode } from "../config";
import { useLocalDatabase } from "../data/provider";
import {
  createTelemetry,
  firstTime,
  installId,
  noTelemetry,
  setTelemetryEnabled,
  type Telemetry,
  telemetryEnabled,
} from "./telemetry";

interface TelemetryState {
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;
  track(event: AnalyticsEvent, props?: AnalyticsProperties): void;
  /** Igual que `track`, pero solo la primera vez en esta instalación. */
  trackFirst(event: AnalyticsEvent, props?: AnalyticsProperties): void;
  report(error: unknown, where?: string): void;
  /** Valor de una feature flag de PostHog; `fallback` mientras no se sabe o sin PostHog. */
  flag(name: string, fallback?: boolean): boolean;
}

const TelemetryContext = createContext<TelemetryState>({
  enabled: false,
  setEnabled: () => undefined,
  track: () => undefined,
  trackFirst: () => undefined,
  report: () => undefined,
  flag: (_name, fallback = false) => fallback,
});

const config = {
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? "",
  posthogKey: process.env.EXPO_PUBLIC_POSTHOG_KEY ?? "",
  posthogHost: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
  release: Constants.expoConfig?.version ?? "0.0.0",
  environment: process.env.EXPO_PUBLIC_ENVIRONMENT ?? (__DEV__ ? "development" : "production"),
  platform: Platform.OS,
};

type Handler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler(): Handler;
  setGlobalHandler(handler: Handler): void;
}

/** Engancha los errores no atrapados: ErrorUtils en Android, eventos de `window` en la web. */
function catchUnhandled(report: (error: unknown) => void): () => void {
  const utils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (utils) {
    const previous = utils.getGlobalHandler();
    utils.setGlobalHandler((error, isFatal) => {
      report(error);
      previous(error, isFatal);
    });
    return () => utils.setGlobalHandler(previous);
  }
  const target = (globalThis as { window?: Window }).window;
  if (!target?.addEventListener) return () => undefined;
  const onError = (e: ErrorEvent) => report(e.error ?? e.message);
  const onRejection = (e: PromiseRejectionEvent) => report(e.reason);
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

/** Errores a Sentry y embudo a PostHog, si la persona no lo apagó (FIN-406). */
export function TelemetryProvider({ children }: { readonly children: ReactNode }) {
  const database = useLocalDatabase();
  const [enabled, setEnabledState] = useState(false);
  const [client, setClient] = useState<Telemetry>(noTelemetry);
  const [flags, setFlags] = useState<Readonly<Record<string, boolean>>>({});

  useEffect(() => {
    if (database.status !== "ready" || e2eMode) return;
    let active = true;
    void (async () => {
      const on = await telemetryEnabled(database.db);
      if (!active) return;
      setEnabledState(on);
      if (!on) return setClient(noTelemetry);
      const next = createTelemetry(config, await installId(database.db));
      if (!active) return;
      setClient(next);
      void next.track("app_opened");
      setFlags(await next.flags());
    })();
    return () => {
      active = false;
    };
  }, [database]);

  useEffect(() => catchUnhandled((error) => void client.report(error)), [client]);

  const setEnabled = useCallback(
    (on: boolean) => {
      setEnabledState(on);
      if (database.status !== "ready") return;
      void setTelemetryEnabled(database.db, on);
      if (!on) setClient(noTelemetry);
      else void installId(database.db).then((id) => setClient(createTelemetry(config, id)));
    },
    [database],
  );

  const value = useMemo<TelemetryState>(
    () => ({
      enabled,
      setEnabled,
      track: (event, props) => void client.track(event, props),
      trackFirst: (event, props) => {
        if (database.status !== "ready" || client === noTelemetry) return;
        void firstTime(database.db, event).then((first) => {
          if (first) void client.track(event, props);
        });
      },
      report: (error, where) => void client.report(error, where),
      flag: (name, fallback = false) => flags[name] ?? fallback,
    }),
    [enabled, setEnabled, client, flags, database],
  );

  return <TelemetryContext.Provider value={value}>{children}</TelemetryContext.Provider>;
}

export const useTelemetry = () => useContext(TelemetryContext);
