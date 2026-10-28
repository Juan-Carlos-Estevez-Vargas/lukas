import {
  bigserial,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { app, userId } from "./common";

export const changeOp = app.enum("change_op", ["upsert", "delete"]);

/** Registro ordenado de cambios por usuario; el sync lee desde un cursor `seq` (FIN-202). */
export const changes = app.table(
  "changes",
  {
    seq: bigserial("seq", { mode: "bigint" }).primaryKey(),
    userId: userId(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id").notNull(),
    op: changeOp("op").notNull(),
    version: integer("version").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("changes_user_seq_idx").on(t.userId, t.seq)],
);

/** Respuestas guardadas por `Idempotency-Key` para que un reintento no duplique escrituras. */
export const idempotencyKeys = app.table(
  "idempotency_keys",
  {
    userId: userId(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

/** Transactional outbox: eventos de dominio guardados en la misma transacción que el cambio. */
export const outbox = app.table(
  "outbox",
  {
    id: uuid("id").primaryKey(),
    aggregate: text("aggregate").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [index("outbox_unpublished_idx").on(t.createdAt)],
);

/** Bitácora de auditoría. Solo admite INSERT: un trigger rechaza UPDATE y DELETE. */
export const auditLog = app.table(
  "audit_log",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    userId: text("user_id"),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_user_idx").on(t.userId, t.createdAt)],
);
