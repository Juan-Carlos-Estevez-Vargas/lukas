import {
  type Entitlements,
  entitlementsOf,
  type Feature,
  hasFeature,
  isFeature,
  isPlan,
} from "@lukas/domain";
import { sqlitePreferences } from "../data/preferences";
import type { SqlConnection } from "../data/sql";

export type { Entitlements, Feature };

/** Última respuesta de la API, para saber qué mostrar sin red (la API decide de verdad). */
const KEY = "billing.entitlements";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

/** Valida lo que llega de la red o de la caché; si algo no cuadra, `null`. */
export function toEntitlements(v: unknown): Entitlements | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.plan !== "string" || !isPlan(o.plan) || !Array.isArray(o.features)) return null;
  const tokens = count(o.aiDailyTokens);
  const requests = count(o.aiDailyRequests);
  if (tokens === null || requests === null) return null;
  return {
    plan: o.plan,
    // Una función que esta versión de la app no conoce se ignora.
    features: o.features.filter((f): f is Feature => typeof f === "string" && isFeature(f)),
    aiDailyTokens: tokens,
    aiDailyRequests: requests,
  };
}

/** Cliente de `GET /v1/billing/entitlements`. `null` si no hay red o la API no responde bien. */
export function createEntitlementsClient(apiUrl: string, fetchImpl: Fetch = fetch) {
  return {
    async fetch(session: string): Promise<Entitlements | null> {
      try {
        const res = await fetchImpl(`${apiUrl}/v1/billing/entitlements`, {
          headers: { authorization: `Bearer ${session}` },
        });
        if (!res.ok) return null;
        return toEntitlements(await res.json());
      } catch {
        return null;
      }
    },
  };
}

export type EntitlementsClient = ReturnType<typeof createEntitlementsClient>;

/** Lo último que dijo la API; sin dato, el plan gratis. El build de e2e prueba todo con premium. */
export async function cachedEntitlements(db: SqlConnection, e2e = false): Promise<Entitlements> {
  if (e2e) return entitlementsOf("premium");
  const raw = await sqlitePreferences(db).get(KEY);
  if (raw === null) return entitlementsOf("free");
  try {
    return toEntitlements(JSON.parse(raw)) ?? entitlementsOf("free");
  } catch {
    return entitlementsOf("free");
  }
}

/** Pregunta a la API y guarda la respuesta. Sin red deja la caché como estaba. */
export async function refreshEntitlements(
  db: SqlConnection,
  client: EntitlementsClient,
  session: string,
): Promise<Entitlements | null> {
  const fresh = await client.fetch(session);
  if (fresh) await sqlitePreferences(db).set(KEY, JSON.stringify(fresh));
  return fresh;
}

/** Si el plan guardado incluye la función. */
export async function canUse(db: SqlConnection, feature: Feature, e2e = false): Promise<boolean> {
  return hasFeature(await cachedEntitlements(db, e2e), feature);
}

/** Al cerrar sesión el plan deja de aplicar en este teléfono. */
export async function forgetEntitlements(db: SqlConnection): Promise<void> {
  await sqlitePreferences(db).remove(KEY);
}
