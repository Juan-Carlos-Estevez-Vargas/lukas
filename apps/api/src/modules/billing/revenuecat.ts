import type { BillingEvent, SubscriptionCommand } from "@lukas/domain";
import type { Env } from "../../env";

/**
 * Adaptador de RevenueCat (FIN-403): traduce sus webhooks a eventos de la saga. La app llama a
 * `Purchases.logIn(userId)`, así que `app_user_id` es el id de la persona en Lukas.
 * Docs: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
 */
export interface RevenueCatConfig {
  /** Valor del encabezado Authorization configurado en RevenueCat (`wrangler secret put`). */
  readonly webhookSecret: string;
  /** Ambientes de tienda aceptados: producción solo acepta compras reales. */
  readonly environments: readonly ("SANDBOX" | "PRODUCTION")[];
}

export function revenueCatConfig(env: Env): RevenueCatConfig | undefined {
  if (!env.REVENUECAT_WEBHOOK_SECRET) return undefined;
  return {
    webhookSecret: env.REVENUECAT_WEBHOOK_SECRET,
    environments: env.ENVIRONMENT === "production" ? ["PRODUCTION"] : ["SANDBOX", "PRODUCTION"],
  };
}

const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** El encabezado puede venir con o sin "Bearer ". */
export function authorized(header: string | undefined, config: RevenueCatConfig): boolean {
  if (!header) return false;
  const value = header.startsWith("Bearer ") ? header.slice(7) : header;
  return safeEqual(value, config.webhookSecret);
}

/** Lo que usamos de un evento. El resto (precio, país, tienda) se ignora y no se guarda. */
export interface RevenueCatEvent {
  readonly id: string;
  readonly type: string;
  readonly appUserId: string;
  readonly at: Date;
  readonly expiresAt: Date | undefined;
  readonly cancelReason: string | undefined;
  readonly environment: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const msDate = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? new Date(v) : undefined;

/** Lee el cuerpo del webhook; `null` si no tiene la forma esperada. */
export function parseEvent(body: unknown): RevenueCatEvent | null {
  if (!isRecord(body) || !isRecord(body.event)) return null;
  const e = body.event;
  const at = msDate(e.event_timestamp_ms);
  if (
    typeof e.id !== "string" ||
    typeof e.type !== "string" ||
    typeof e.app_user_id !== "string" ||
    typeof e.environment !== "string" ||
    !at
  )
    return null;
  return {
    id: e.id,
    type: e.type,
    appUserId: e.app_user_id,
    at,
    expiresAt: msDate(e.expiration_at_ms),
    cancelReason: typeof e.cancel_reason === "string" ? e.cancel_reason : undefined,
    environment: e.environment,
  };
}

const PAID = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "PRODUCT_CHANGE",
  "NON_RENEWING_PURCHASE",
]);

/**
 * Traduce un evento a un comando de la saga, o `null` si no cambia nada (eventos de prueba,
 * transferencias, usuarios anónimos, otro ambiente).
 *
 * | RevenueCat                                   | saga              |
 * | -------------------------------------------- | ----------------- |
 * | INITIAL_PURCHASE, RENEWAL, UNCANCELLATION, … | payment_succeeded |
 * | CANCELLATION (reembolso de soporte)          | refunded          |
 * | CANCELLATION (otro motivo)                   | renewal_canceled  |
 * | BILLING_ISSUE                                | payment_failed    |
 * | EXPIRATION                                   | expired           |
 */
export function toCommand(
  event: RevenueCatEvent,
  config: RevenueCatConfig,
): SubscriptionCommand | null {
  if (!(config.environments as readonly string[]).includes(event.environment)) return null;
  if (event.appUserId.startsWith("$RCAnonymousID:")) return null;
  let billing: BillingEvent | null = null;
  if (PAID.has(event.type)) {
    if (!event.expiresAt || event.expiresAt.getTime() <= event.at.getTime()) return null;
    billing = { type: "payment_succeeded", at: event.at, periodEnd: event.expiresAt };
  } else if (event.type === "CANCELLATION") {
    billing =
      event.cancelReason === "CUSTOMER_SUPPORT"
        ? { type: "refunded", at: event.at }
        : { type: "renewal_canceled", at: event.at };
  } else if (event.type === "BILLING_ISSUE") {
    billing = { type: "payment_failed", at: event.at };
  } else if (event.type === "EXPIRATION") {
    billing = { type: "expired", at: event.at };
  }
  if (!billing) return null;
  return { userId: event.appUserId, provider: "revenuecat", plan: "premium", event: billing };
}
