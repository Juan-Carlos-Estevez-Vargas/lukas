import { withUser } from "@lukas/db";
import { legalConsents } from "@lukas/db/schema";
import type { LegalConsent } from "@lukas/domain";
import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { TablesRelationalConfig } from "drizzle-orm/relations";

/** Puerto de las autorizaciones: cada quien lee y registra las suyas (RLS). */
export interface ConsentStore {
  list(userId: string): Promise<LegalConsent[]>;
  /** Registra las versiones aceptadas; aceptar dos veces la misma no hace nada. */
  accept(userId: string, consents: readonly LegalConsent[]): Promise<void>;
}

export function postgresConsents<
  Q extends PgQueryResultHKT,
  Full extends Record<string, unknown>,
  Schema extends TablesRelationalConfig,
>(db: PgDatabase<Q, Full, Schema>): ConsentStore {
  return {
    list: (userId) =>
      withUser(db, userId, (tx) =>
        tx
          .select({ document: legalConsents.document, version: legalConsents.version })
          .from(legalConsents)
          .where(eq(legalConsents.userId, userId)),
      ),
    accept: (userId, consents) =>
      withUser(db, userId, async (tx) => {
        if (consents.length === 0) return;
        await tx
          .insert(legalConsents)
          .values(consents.map((c) => ({ userId, document: c.document, version: c.version })))
          .onConflictDoNothing();
      }),
  };
}
