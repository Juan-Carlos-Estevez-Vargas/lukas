import { char, integer, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

/** Todo el dominio financiero vive en el esquema `app`; la autenticación vive en `auth`. */
export const app = pgSchema("app");

/** Identificador UUIDv7 generado por el cliente (ver `uuidv7` en @lukas/domain). */
export const id = () => uuid("id").primaryKey();

/** Dueño del registro. Al borrar la cuenta se borran sus datos (derecho de supresión, Ley 1581). */
export const userId = () =>
  text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

/** Código ISO 4217. */
export const currency = () => char("currency", { length: 3 }).notNull();

/** Columnas de auditoría y control de concurrencia optimista usadas por el sync. */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  version: integer("version").notNull().default(1),
};
