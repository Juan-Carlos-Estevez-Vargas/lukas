import {
  type AnalyticsEvent,
  type AnalyticsProperties,
  cleanProperties,
  type ErrorContext,
  parseDsn,
  sentryEnvelope,
  sentryRequest,
  uuidv7,
} from "@lukas/domain";
import { sqlitePreferences } from "../data/preferences";
import type { SqlConnection } from "../data/sql";

/**
 * Telemetría de la app (FIN-406): errores a Sentry y embudo de activación a PostHog, por HTTP y
 * sin SDKs. Todo pasa por la limpieza de @lukas/domain. Se identifica con un id de instalación
 * aleatorio, nunca con el correo ni el id de la cuenta. La persona la puede apagar en Ajustes.
 */
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface TelemetryConfig {
  readonly sentryDsn?: string;
  readonly posthogKey?: string;
  readonly posthogHost: string;
  readonly release: string;
  readonly environment: string;
  readonly platform: string;
}

export interface Telemetry {
  report(error: unknown, where?: string): Promise<void>;
  track(event: AnalyticsEvent, props?: AnalyticsProperties): Promise<void>;
  /** Feature flags de PostHog activas para esta instalación. */
  flags(): Promise<Readonly<Record<string, boolean>>>;
}

export const noTelemetry: Telemetry = {
  report: async () => undefined,
  track: async () => undefined,
  flags: async () => ({}),
};

export function createTelemetry(
  config: TelemetryConfig,
  installId: string,
  fetchImpl: Fetch = (input, init) => fetch(input, init),
): Telemetry {
  const dsn = parseDsn(config.sentryDsn);
  const host = config.posthogHost.replace(/\/$/, "");
  const key = config.posthogKey ?? "";
  const base: Omit<ErrorContext, "where"> = {
    service: "mobile",
    release: config.release,
    environment: config.environment,
    platform: config.platform,
  };
  const post = (url: string, init: RequestInit) =>
    fetchImpl(url, { method: "POST", ...init }).catch(() => undefined);

  return {
    async report(error, where) {
      if (!dsn) return;
      const { url, headers } = sentryRequest(dsn, `lukas-mobile/${config.release}`);
      await post(url, {
        headers,
        body: sentryEnvelope(error, { ...base, ...(where ? { where } : {}) }, new Date()),
      });
    },
    async track(event, props) {
      if (!key) return;
      await post(`${host}/capture/`, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: key,
          event,
          distinct_id: installId,
          timestamp: new Date().toISOString(),
          properties: {
            ...cleanProperties(props),
            // Eventos anónimos: PostHog no arma un perfil de persona.
            $process_person_profile: false,
            platform: config.platform,
            app_version: config.release,
          },
        }),
      });
    },
    async flags() {
      if (!key) return {};
      const res = await post(`${host}/decide/?v=3`, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: key, distinct_id: installId }),
      });
      const body = (await res?.json().catch(() => null)) as { featureFlags?: unknown } | null;
      const out: Record<string, boolean> = {};
      if (body && typeof body.featureFlags === "object" && body.featureFlags !== null) {
        for (const [name, value] of Object.entries(body.featureFlags)) {
          out[name] = value === true || (typeof value === "string" && value !== "false");
        }
      }
      return out;
    },
  };
}

/** Preferencia de la persona: encendida salvo que la apague en Ajustes. */
export async function telemetryEnabled(db: SqlConnection): Promise<boolean> {
  return (await sqlitePreferences(db).get("telemetry.enabled")) !== "false";
}

export async function setTelemetryEnabled(db: SqlConnection, enabled: boolean): Promise<void> {
  await sqlitePreferences(db).set("telemetry.enabled", enabled ? "true" : "false");
}

/** Id aleatorio de esta instalación; no se relaciona con la cuenta. */
export async function installId(db: SqlConnection, newId: () => string = uuidv7): Promise<string> {
  const prefs = sqlitePreferences(db);
  const existing = await prefs.get("telemetry.installId");
  if (existing) return existing;
  const id = newId();
  await prefs.set("telemetry.installId", id);
  return id;
}

/** Eventos que solo cuentan la primera vez en esta instalación (p. ej. el primer movimiento). */
export async function firstTime(db: SqlConnection, event: AnalyticsEvent): Promise<boolean> {
  const prefs = sqlitePreferences(db);
  const seen = new Set((await prefs.get("telemetry.firsts"))?.split(",") ?? []);
  if (seen.has(event)) return false;
  seen.add(event);
  await prefs.set("telemetry.firsts", [...seen].join(","));
  return true;
}
