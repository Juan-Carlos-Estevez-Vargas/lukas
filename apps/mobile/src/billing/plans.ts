import type { SubscriptionStatus } from "@lukas/domain";
import { sqlitePreferences } from "../data/preferences";
import type { SqlConnection } from "../data/sql";
import { type Entitlements, toEntitlements } from "./entitlements";

/** Lo que muestra la pantalla de planes: el plan, la suscripción y si puede probar gratis. */
export interface BillingStatus {
  readonly entitlements: Entitlements;
  readonly subscription: { readonly status: SubscriptionStatus; readonly periodEnd: Date } | null;
  readonly trialAvailable: boolean;
}

export type BillingError =
  | "signed_out"
  | "trial_unavailable"
  | "coupon_unknown"
  | "coupon_used"
  | "coupon_expired"
  | "coupon_exhausted"
  | "rate_limited"
  | "unavailable"
  | "network"
  | "unexpected";

export type BillingOutcome =
  | { readonly ok: true; readonly value: BillingStatus }
  | { readonly ok: false; readonly error: BillingError };

const STATUSES: readonly string[] = ["trialing", "active", "past_due", "canceled", "expired"];
const PROBLEMS: readonly string[] = [
  "trial_unavailable",
  "coupon_unknown",
  "coupon_used",
  "coupon_expired",
  "coupon_exhausted",
  "rate_limited",
];

/** Valida la respuesta de la API (`Entitlements` con suscripción y prueba). */
export function toBillingStatus(v: unknown): BillingStatus | null {
  const entitlements = toEntitlements(v);
  if (!entitlements) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.trialAvailable !== "boolean") return null;
  let subscription: BillingStatus["subscription"] = null;
  if (o.subscription !== null) {
    const s = o.subscription as Record<string, unknown> | undefined;
    const periodEnd = typeof s?.periodEnd === "string" ? new Date(s.periodEnd) : null;
    if (
      typeof s?.status !== "string" ||
      !STATUSES.includes(s.status) ||
      !periodEnd ||
      Number.isNaN(periodEnd.getTime())
    )
      return null;
    subscription = { status: s.status as SubscriptionStatus, periodEnd };
  }
  return { entitlements, subscription, trialAvailable: o.trialAvailable };
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Cliente de `/v1/billing/*`: estado, prueba gratis y cupones. */
export function createBillingClient(apiUrl: string, fetchImpl: Fetch = fetch) {
  const call = async (
    method: "GET" | "POST",
    path: string,
    session: string,
    body?: unknown,
  ): Promise<BillingOutcome> => {
    let res: Response;
    try {
      res = await fetchImpl(`${apiUrl}/v1/billing/${path}`, {
        method,
        headers: {
          authorization: `Bearer ${session}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      return { ok: false, error: "network" };
    }
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      if (res.status === 401) return { ok: false, error: "signed_out" };
      if (res.status === 503) return { ok: false, error: "unavailable" };
      const code = typeof json?.code === "string" ? json.code : "";
      return {
        ok: false,
        error: PROBLEMS.includes(code) ? (code as BillingError) : "unexpected",
      };
    }
    const status = toBillingStatus(json);
    return status ? { ok: true, value: status } : { ok: false, error: "unexpected" };
  };
  return {
    status: (session: string) => call("GET", "entitlements", session),
    startTrial: (session: string) => call("POST", "trial", session),
    redeem: (session: string, code: string) =>
      call("POST", "coupons/redeem", session, { code: code.trim().slice(0, 64) }),
  };
}

export type BillingClient = ReturnType<typeof createBillingClient>;

/** Guarda el plan nuevo para que el resto de la app lo vea sin esperar a la red. */
export async function rememberEntitlements(db: SqlConnection, entitlements: Entitlements) {
  await sqlitePreferences(db).set("billing.entitlements", JSON.stringify(entitlements));
}
