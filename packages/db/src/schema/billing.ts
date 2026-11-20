import { sql } from "drizzle-orm";
import { check, index, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
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
