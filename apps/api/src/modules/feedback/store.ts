import { withUser } from "@lukas/db";
import { feedback } from "@lukas/db/schema";
import type { FeedbackKind } from "@lukas/domain";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { TablesRelationalConfig } from "drizzle-orm/relations";

export interface FeedbackEntry {
  readonly kind: FeedbackKind;
  readonly message: string;
  readonly appVersion: string;
  readonly platform: "android" | "ios" | "web";
}

/** Puerto de los comentarios: la persona solo agrega los suyos (RLS). */
export interface FeedbackStore {
  add(userId: string, entry: FeedbackEntry): Promise<void>;
}

export function postgresFeedback<
  Q extends PgQueryResultHKT,
  Full extends Record<string, unknown>,
  Schema extends TablesRelationalConfig,
>(db: PgDatabase<Q, Full, Schema>): FeedbackStore {
  return {
    add: (userId, entry) =>
      withUser(db, userId, async (tx) => {
        await tx.insert(feedback).values({ userId, ...entry });
      }),
  };
}
