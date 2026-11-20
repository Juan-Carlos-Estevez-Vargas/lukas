import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { app, userId } from "./common";
import { transactions } from "./ledger";

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

/**
 * Tasas de cambio oficiales por día (p. ej. la TRM USD→COP de la Superfinanciera, publicada en
 * datos abiertos). Son datos públicos, no del usuario. `rate` es exacto: unidades de `quote` por
 * una unidad de `base`.
 */
export const exchangeRates = app.table(
  "exchange_rates",
  {
    base: char("base", { length: 3 }).notNull(),
    quote: char("quote", { length: 3 }).notNull(),
    day: date("day", { mode: "string" }).notNull(),
    rate: numeric("rate", { precision: 18, scale: 6 }).notNull(),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.base, t.quote, t.day] }),
    check("exchange_rates_positive", sql`${t.rate} > 0`),
  ],
);

/** Tokens del agente de IA usados por día (día de Colombia), para la cuota diaria gratuita. */
export const aiUsage = app.table(
  "ai_usage",
  {
    userId: userId(),
    day: date("day").notNull(),
    tokens: integer("tokens").notNull().default(0),
    requests: integer("requests").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.day] }),
    check("ai_usage_counts", sql`${t.tokens} >= 0 AND ${t.requests} >= 0`),
  ],
);

export const pushPlatform = app.enum("push_platform", ["android", "ios"]);

/**
 * Teléfonos que reciben avisos push (token de Expo). Una fila por persona y token: si el teléfono
 * cambia de cuenta, el cron solo usa la fila más reciente de cada token.
 */
export const pushDevices = app.table(
  "push_devices",
  {
    userId: userId(),
    token: text("token").notNull(),
    platform: pushPlatform("platform").notNull(),
    /** Resumen de la semana los domingos (FIN-309). */
    weeklySummary: boolean("weekly_summary").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.token] }),
    index("push_devices_token_idx").on(t.token),
    check("push_devices_token_shape", sql`length(${t.token}) BETWEEN 10 AND 200`),
  ],
);

/** Dimensiones de bge-m3 (Workers AI), el modelo de embeddings multilingüe. */
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * Embedding de cada movimiento para buscar por significado (FIN-310). `content_hash` dice con qué
 * texto se calculó: si el comercio o la categoría cambian, se recalcula.
 */
export const transactionEmbeddings = app.table(
  "transaction_embeddings",
  {
    transactionId: uuid("transaction_id")
      .primaryKey()
      .references(() => transactions.id, { onDelete: "cascade" }),
    userId: userId(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    contentHash: text("content_hash").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transaction_embeddings_user_idx").on(t.userId),
    index("transaction_embeddings_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const legalDocument = app.enum("legal_document", ["privacy", "terms"]);

/**
 * Prueba de la autorización (Ley 1581, art. 9 y Decreto 1377, art. 8): qué versión de cada
 * documento aceptó la persona y cuándo. Solo se agregan filas; nunca se cambian ni se borran
 * (salvo al borrar la cuenta).
 */
export const legalConsents = app.table(
  "legal_consents",
  {
    userId: userId(),
    document: legalDocument("document").notNull(),
    version: text("version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.document, t.version] }),
    check("legal_consents_version", sql`${t.version} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
  ],
);

export const feedbackKind = app.enum("feedback_kind", ["bug", "idea", "other"]);

/**
 * Comentarios de la beta (FIN-408). La persona solo puede agregar los suyos; leerlos es cosa del
 * equipo, con el rol dueño. El texto llega limpio de tarjetas (`cleanFeedback`).
 */
export const feedback = app.table(
  "feedback",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    userId: userId(),
    kind: feedbackKind("kind").notNull(),
    message: text("message").notNull(),
    appVersion: text("app_version").notNull(),
    platform: text("platform").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("feedback_message_length", sql`char_length(${t.message}) between 5 and 2000`),
    check("feedback_platform", sql`${t.platform} in ('android', 'ios', 'web')`),
    check("feedback_app_version", sql`char_length(${t.appVersion}) <= 32`),
    index("feedback_created_at").on(t.createdAt),
  ],
);
