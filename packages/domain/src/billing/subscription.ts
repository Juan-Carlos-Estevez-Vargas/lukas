import { DomainError } from "../errors";
import { err, ok, type Result } from "../result";
import { type Entitlements, entitlementsOf, type Plan, TRIAL_DAYS } from "./plans";

/** Quién cobra. `manual` es para soporte y pruebas: activar premium a mano en la base. */
export const BILLING_PROVIDERS = ["wompi", "revenuecat", "manual", "trial", "coupon"] as const;
export type BillingProvider = (typeof BILLING_PROVIDERS)[number];

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "expired",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Días que se mantiene premium después de un pago fallido, mientras el proveedor reintenta. */
export const GRACE_DAYS = 3;
const DAY_MS = 86_400_000;

export interface Subscription {
  readonly userId: string;
  readonly plan: Plan;
  readonly status: SubscriptionStatus;
  readonly provider: BillingProvider;
  /** Hasta cuándo está pagado (o hasta cuándo va la prueba). */
  readonly periodEnd: Date;
  /** Instante del último evento aplicado; los eventos más viejos se ignoran (llegan desordenados). */
  readonly lastEventAt: Date;
}

/**
 * Hechos que reportan los proveedores, ya traducidos a un idioma común. Cada adaptador (Wompi,
 * RevenueCat) convierte sus webhooks a estos eventos; la saga no conoce a ningún proveedor.
 */
export type BillingEvent =
  | { readonly type: "trial_started"; readonly at: Date; readonly endsAt: Date }
  | { readonly type: "payment_succeeded"; readonly at: Date; readonly periodEnd: Date }
  /** Días de premium regalados (cupón o soporte): se suman a lo que ya tenga vigente. */
  | { readonly type: "granted"; readonly at: Date; readonly days: number }
  | { readonly type: "payment_failed"; readonly at: Date }
  | { readonly type: "renewal_canceled"; readonly at: Date }
  | { readonly type: "expired"; readonly at: Date }
  | { readonly type: "refunded"; readonly at: Date };

export interface SubscriptionCommand {
  readonly userId: string;
  readonly provider: BillingProvider;
  readonly plan: Plan;
  readonly event: BillingEvent;
}

/** Resultado de aplicar un evento: el estado nuevo, o `stale` si el evento es más viejo. */
export type Transition =
  | { readonly kind: "changed"; readonly subscription: Subscription }
  | { readonly kind: "stale" };

const invalid = (message: string) => err(new DomainError("billing_invalid_event", message));

/**
 * Saga de la suscripción: cada evento mueve el estado según la tabla de abajo. Es pura; quien la
 * usa guarda el resultado, registra el evento como procesado y publica el cambio en la misma
 * transacción (outbox), así que repetir un webhook no cambia nada.
 *
 * | evento            | resultado                                             |
 * | ----------------- | ----------------------------------------------------- |
 * | trial_started     | trialing hasta `endsAt` (solo si nunca hubo suscripción) |
 * | payment_succeeded | active hasta `periodEnd`                              |
 * | granted           | active `days` días más, desde el fin vigente o desde ya |
 * | payment_failed    | past_due; premium sigue `GRACE_DAYS` días             |
 * | renewal_canceled  | canceled; premium sigue hasta el fin del periodo      |
 * | expired, refunded | expired desde ya                                      |
 */
export function applyBillingEvent(
  current: Subscription | undefined,
  command: SubscriptionCommand,
): Result<Transition, DomainError> {
  const { event } = command;
  if (current && event.at.getTime() < current.lastEventAt.getTime()) return ok({ kind: "stale" });
  const next = (status: SubscriptionStatus, periodEnd: Date): Transition => ({
    kind: "changed",
    subscription: {
      userId: command.userId,
      plan: command.plan,
      status,
      provider: command.provider,
      periodEnd,
      lastEventAt: event.at,
    },
  });

  switch (event.type) {
    case "trial_started":
      if (current) return invalid("La prueba gratis es solo para quien nunca tuvo premium");
      if (event.endsAt.getTime() <= event.at.getTime())
        return invalid("La prueba debe terminar después de empezar");
      return ok(next("trialing", event.endsAt));
    case "payment_succeeded":
      if (event.periodEnd.getTime() <= event.at.getTime())
        return invalid("El periodo pagado debe terminar después del pago");
      return ok(next("active", event.periodEnd));
    case "granted": {
      if (!Number.isInteger(event.days) || event.days < 1 || event.days > 366)
        return invalid("Los días regalados van de 1 a 366");
      const from =
        current && isEntitled(current, event.at) ? current.periodEnd.getTime() : event.at.getTime();
      return ok(next("active", new Date(from + event.days * DAY_MS)));
    }
    case "payment_failed":
      if (!current) return invalid("No hay suscripción para marcar en mora");
      return ok(next("past_due", new Date(event.at.getTime() + GRACE_DAYS * DAY_MS)));
    case "renewal_canceled":
      if (!current) return invalid("No hay suscripción para cancelar");
      return ok(next("canceled", current.periodEnd));
    case "expired":
    case "refunded":
      if (!current) return invalid("No hay suscripción para terminar");
      return ok(next("expired", event.at));
  }
}

/** Si la suscripción da acceso en `now`: cualquier estado salvo `expired`, mientras no venza. */
export const isEntitled = (subscription: Subscription | undefined, now: Date): boolean =>
  subscription !== undefined &&
  subscription.status !== "expired" &&
  now.getTime() < subscription.periodEnd.getTime();

/** Lo que puede usar la persona ahora: su plan si sigue vigente; si no, el gratis. */
export const currentEntitlements = (
  subscription: Subscription | undefined,
  now: Date,
): Entitlements =>
  subscription && isEntitled(subscription, now)
    ? entitlementsOf(subscription.plan)
    : entitlementsOf("free");

/** Fin de la prueba gratis si empieza en `now`. */
export const trialEndsAt = (now: Date): Date => new Date(now.getTime() + TRIAL_DAYS * DAY_MS);

/** La prueba es solo para quien nunca tuvo suscripción (ni prueba, ni pago, ni cupón). */
export const canStartTrial = (subscription: Subscription | undefined): boolean =>
  subscription === undefined;

const COUPON = /^[A-Z0-9][A-Z0-9-]{2,30}[A-Z0-9]$/;

/** Código de cupón en mayúsculas y sin espacios; `null` si no tiene la forma de un cupón. */
export function normalizeCouponCode(raw: string): string | null {
  const code = raw.trim().toUpperCase().replace(/\s+/g, "");
  return COUPON.test(code) ? code : null;
}
