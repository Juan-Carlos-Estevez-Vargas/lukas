import { sqlitePreferences } from "../data/preferences";
import type { SqlConnection } from "../data/sql";

export interface PushToken {
  readonly token: string;
  readonly platform: "android" | "ios";
}

/** Puerto del token push del teléfono (expo-notifications en el teléfono, nada en la web). */
export interface PushTokenSource {
  readonly available: boolean;
  /** `null` si la persona niega el permiso o el build no tiene proyecto de EAS. */
  token(): Promise<PushToken | null>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Cliente de `/v1/notifications/device`. */
export function createDeviceClient(apiUrl: string, fetchImpl: Fetch = fetch) {
  const call = async (method: "PUT" | "DELETE", session: string, body: unknown) => {
    try {
      const res = await fetchImpl(`${apiUrl}/v1/notifications/device`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${session}` },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    }
  };
  return {
    register: (session: string, device: PushToken & { weeklySummary: boolean }) =>
      call("PUT", session, device),
    remove: (session: string, token: string) => call("DELETE", session, { token }),
  };
}

export type DeviceClient = ReturnType<typeof createDeviceClient>;

export type WeeklyResult = "on" | "off" | "denied" | "offline";

/** ¿Este teléfono recibe el resumen del domingo? */
export async function weeklyEnabled(db: SqlConnection): Promise<boolean> {
  return (await sqlitePreferences(db).get("notifications.weekly")) !== null;
}

/**
 * Enciende o apaga el resumen semanal. Al encender registra el token en la API; al apagar lo
 * borra. Lo local solo cambia si la API respondió, para no quedar a medias.
 */
export async function setWeeklySummary(
  db: SqlConnection,
  deps: {
    readonly source: PushTokenSource;
    readonly client: DeviceClient;
    readonly session: string;
  },
  on: boolean,
): Promise<WeeklyResult> {
  const prefs = sqlitePreferences(db);
  if (!on) {
    const saved = await prefs.get("notifications.weekly");
    if (saved && !(await deps.client.remove(deps.session, saved))) return "offline";
    await prefs.remove("notifications.weekly");
    return "off";
  }
  const push = await deps.source.token();
  if (!push) return "denied";
  if (!(await deps.client.register(deps.session, { ...push, weeklySummary: true }))) {
    return "offline";
  }
  await prefs.set("notifications.weekly", push.token);
  return "on";
}

/** Al cerrar sesión: que el teléfono no siga recibiendo resúmenes de esa cuenta. */
export async function forgetDevice(db: SqlConnection, client: DeviceClient, session: string) {
  const prefs = sqlitePreferences(db);
  const saved = await prefs.get("notifications.weekly");
  if (!saved) return;
  await client.remove(session, saved);
  await prefs.remove("notifications.weekly");
}
