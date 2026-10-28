import { char, integer, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Todo el dominio financiero vive en el esquema `app`; la autenticación tendrá el suyo (FIN-009). */
export const app = pgSchema("app");

/** Identificador UUIDv7 generado por el cliente (ver `uuidv7` en @lukas/domain). */
export const id = () => uuid("id").primaryKey();

/** Dueño del registro. La FK a la tabla de usuarios llega con la autenticación (FIN-009). */
export const userId = () => text("user_id").notNull();

/** Código ISO 4217. */
export const currency = () => char("currency", { length: 3 }).notNull();

/** Columnas de auditoría y control de concurrencia optimista usadas por el sync. */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
};
