import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { app, userId } from "./common";

export const plan = app.enum("plan", ["free", "premium"]);
export const subscriptionStatus = app.enum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "expired",
]);
export const billingProvider = app.enum("billing_provider", [
  "wompi",
  "revenuecat",
  "manual",
  "trial",
  "coupon",
]);

/**
 * Suscripción de cada persona (FIN-401): una fila por persona, que la saga de Billing actualiza
 * con los eventos de los proveedores. La app solo la lee; escribirla es cosa del servidor, así
 * que nadie se puede regalar premium desde su sesión.
 */
export const subscriptions = app.table(
  "subscriptions",
  {
    userId: userId().primaryKey(),
    plan: plan("plan").notNull(),
    status: subscriptionStatus("status").notNull(),
    provider: billingProvider("provider").notNull(),
    /** Id de la suscripción o del cliente en el proveedor, para conciliar. Nunca datos de tarjeta. */
    providerRef: text("provider_ref"),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("subscriptions_period_end_idx").on(t.periodEnd)],
);

/**
 * Eventos de facturación ya procesados, por proveedor e id del evento: si un webhook llega dos
 * veces, el segundo no hace nada. Solo guarda el tipo, no el cuerpo del webhook.
 */
export const billingEvents = app.table(
  "billing_events",
  {
    provider: billingProvider("provider").notNull(),
    eventId: text("event_id").notNull(),
    userId: userId(),
    type: text("type").notNull(),
    outcome: text("outcome").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.eventId] }),
    index("billing_events_user_idx").on(t.userId, t.receivedAt),
    check("billing_events_id_shape", sql`length(${t.eventId}) BETWEEN 1 AND 200`),
  ],
);

/**
 * Cupones de días de premium (FIN-404). Los crea soporte en la base; la app solo manda el código
 * y el servidor lo canjea. Un cupón sirve una vez por persona y, si tiene tope, hasta `max_redemptions`.
 */
export const coupons = app.table(
  "coupons",
  {
    code: text("code").primaryKey(),
    days: integer("days").notNull(),
    maxRedemptions: integer("max_redemptions"),
    redemptions: integer("redemptions").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("coupons_code_shape", sql`${t.code} ~ '^[A-Z0-9][A-Z0-9-]{2,30}[A-Z0-9]$'`),
    check("coupons_days", sql`${t.days} BETWEEN 1 AND 366`),
    check(
      "coupons_redemptions",
      sql`${t.redemptions} >= 0 AND (${t.maxRedemptions} IS NULL OR ${t.redemptions} <= ${t.maxRedemptions})`,
    ),
  ],
);

/** Quién canjeó cada cupón: evita que la misma persona lo use dos veces. */
export const couponRedemptions = app.table(
  "coupon_redemptions",
  {
    code: text("code")
      .notNull()
      .references(() => coupons.code, { onDelete: "cascade" }),
    userId: userId(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.code, t.userId] })],
);

/**
 * Pagos iniciados en el checkout web de Wompi (FIN-402). La referencia es aleatoria; el webhook
 * la usa para saber de quién es el pago y verificar que el monto sea el del precio. Solo el
 * servidor la lee y la escribe: la app no tiene permisos sobre esta tabla.
 */
export const paymentCheckouts = app.table(
  "payment_checkouts",
  {
    reference: text("reference").primaryKey(),
    userId: userId(),
    priceId: text("price_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payment_checkouts_user_idx").on(t.userId, t.createdAt),
    check("payment_checkouts_reference_shape", sql`${t.reference} ~ '^lk[0-9a-z]{24}$'`),
    check("payment_checkouts_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);
