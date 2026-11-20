import { withUser } from "@lukas/db";
import { billingEvents, couponRedemptions, coupons, outbox, subscriptions } from "@lukas/db/schema";
import {
  applyBillingEvent,
  currentEntitlements,
  type Entitlements,
  type Subscription,
  type SubscriptionCommand,
  trialEndsAt,
} from "@lukas/domain";
import { and, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { TablesRelationalConfig } from "drizzle-orm/relations";

/** Qué pasó con un evento: aplicado, más viejo que el estado, repetido o sin sentido. */
export type BillingOutcome = "changed" | "stale" | "duplicate" | "rejected";

/** Puerto de Billing: los adaptadores de pago le entregan eventos y el resto pregunta qué puede usar. */
export interface BillingStore {
  /** La suscripción de la persona, leída como ella (RLS). */
  subscription(userId: string): Promise<Subscription | undefined>;
  /** Lo que la persona puede usar en `now`. */
  entitlements(userId: string, now: Date): Promise<Entitlements>;
  /**
   * Saga de la suscripción: registra el evento por (proveedor, id), aplica la transición, guarda
   * el estado y deja `SubscriptionChanged` en la bandeja de salida, todo en una transacción.
   * Un evento repetido devuelve `duplicate` sin tocar nada.
   */
  process(
    eventId: string,
    command: SubscriptionCommand,
    providerRef?: string,
  ): Promise<BillingOutcome>;
  /** Prueba gratis de premium; `rejected` o `duplicate` si la persona ya tuvo suscripción. */
  startTrial(userId: string, now: Date): Promise<BillingOutcome>;
  /** Canjea un cupón de días de premium (código ya normalizado). */
  redeemCoupon(userId: string, code: string, now: Date): Promise<CouponOutcome>;
}

/** Resultado de canjear un cupón. */
export type CouponOutcome = "redeemed" | "unknown" | "expired" | "exhausted" | "used";

type Row = typeof subscriptions.$inferSelect;

class CouponNotApplied extends Error {}

const toSubscription = (row: Row): Subscription => ({
  userId: row.userId,
  plan: row.plan,
  status: row.status,
  provider: row.provider,
  periodEnd: row.periodEnd,
  lastEventAt: row.lastEventAt,
});

export function postgresBilling<
  Q extends PgQueryResultHKT,
  Full extends Record<string, unknown>,
  Schema extends TablesRelationalConfig,
>(db: PgDatabase<Q, Full, Schema>, newId: () => string = () => crypto.randomUUID()): BillingStore {
  const subscription = (userId: string) =>
    withUser(db, userId, async (tx) => {
      const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.userId, userId));
      return row ? toSubscription(row) : undefined;
    });

  // Corre como dueño de las tablas: la app no puede escribir suscripciones (ver 0008).
  const processIn = async (
    tx: PgTransaction<Q, Full, Schema>,
    eventId: string,
    command: SubscriptionCommand,
    providerRef?: string,
  ): Promise<BillingOutcome> => {
    const recorded = await tx
      .insert(billingEvents)
      .values({
        provider: command.provider,
        eventId,
        userId: command.userId,
        type: command.event.type,
        outcome: "pending",
      })
      .onConflictDoNothing()
      .returning({ eventId: billingEvents.eventId });
    if (recorded.length === 0) return "duplicate";

    const [row] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, command.userId))
      .for("update");
    const result = applyBillingEvent(row ? toSubscription(row) : undefined, command);
    const outcome: BillingOutcome = !result.ok
      ? "rejected"
      : result.value.kind === "stale"
        ? "stale"
        : "changed";

    if (result.ok && result.value.kind === "changed") {
      const next = result.value.subscription;
      const values = {
        plan: next.plan,
        status: next.status,
        provider: next.provider,
        periodEnd: next.periodEnd,
        lastEventAt: next.lastEventAt,
        updatedAt: sql`now()`,
        ...(providerRef === undefined ? {} : { providerRef }),
      };
      await tx
        .insert(subscriptions)
        .values({ userId: next.userId, ...values })
        .onConflictDoUpdate({ target: subscriptions.userId, set: values });
      await tx.insert(outbox).values({
        id: newId(),
        aggregate: "subscription",
        // El id de la persona no es un UUID: va en el cuerpo del evento.
        aggregateId: newId(),
        eventType: "SubscriptionChanged",
        payload: {
          userId: next.userId,
          plan: next.plan,
          status: next.status,
          provider: next.provider,
          periodEnd: next.periodEnd.toISOString(),
          cause: command.event.type,
        },
      });
    }
    await tx
      .update(billingEvents)
      .set({ outcome })
      .where(and(eq(billingEvents.provider, command.provider), eq(billingEvents.eventId, eventId)));
    return outcome;
  };

  return {
    subscription,
    entitlements: async (userId, now) => currentEntitlements(await subscription(userId), now),
    process: (eventId, command, providerRef) =>
      db.transaction((tx) => processIn(tx, eventId, command, providerRef)),
    startTrial: (userId, now) =>
      db.transaction((tx) =>
        processIn(tx, `trial:${userId}`, {
          userId,
          provider: "trial",
          plan: "premium",
          event: { type: "trial_started", at: now, endsAt: trialEndsAt(now) },
        }),
      ),
    redeemCoupon: (userId, code, now) =>
      db
        .transaction(async (tx): Promise<CouponOutcome> => {
          const [coupon] = await tx
            .select()
            .from(coupons)
            .where(eq(coupons.code, code))
            .for("update");
          if (!coupon) return "unknown";
          const [mine] = await tx
            .select({ code: couponRedemptions.code })
            .from(couponRedemptions)
            .where(and(eq(couponRedemptions.code, code), eq(couponRedemptions.userId, userId)));
          if (mine) return "used";
          if (coupon.expiresAt && coupon.expiresAt.getTime() <= now.getTime()) return "expired";
          if (coupon.maxRedemptions !== null && coupon.redemptions >= coupon.maxRedemptions)
            return "exhausted";
          const claimed = await tx
            .insert(couponRedemptions)
            .values({ code, userId })
            .onConflictDoNothing()
            .returning({ code: couponRedemptions.code });
          if (claimed.length === 0) return "used";
          await tx
            .update(coupons)
            .set({ redemptions: sql`${coupons.redemptions} + 1` })
            .where(eq(coupons.code, code));
          const outcome = await processIn(tx, `coupon:${code}:${userId}`, {
            userId,
            provider: "coupon",
            plan: "premium",
            event: { type: "granted", at: now, days: coupon.days },
          });
          // Un evento más viejo que el estado (relojes) no regala nada: se deshace el canje.
          if (outcome !== "changed") throw new CouponNotApplied();
          return "redeemed";
        })
        .catch((error: unknown) => {
          if (error instanceof CouponNotApplied) return "used" as const;
          throw error;
        }),
  };
}
