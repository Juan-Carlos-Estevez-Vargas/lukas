import { paymentCheckouts } from "@lukas/db/schema";
import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { TablesRelationalConfig } from "drizzle-orm/relations";
import type { Checkout } from "./wompi";

/** Puerto de los pagos iniciados en Wompi. Solo el servidor (como dueño) usa esta tabla. */
export interface CheckoutStore {
  create(checkout: Checkout): Promise<void>;
  find(reference: string): Promise<Checkout | undefined>;
}

export function postgresCheckouts<
  Q extends PgQueryResultHKT,
  Full extends Record<string, unknown>,
  Schema extends TablesRelationalConfig,
>(db: PgDatabase<Q, Full, Schema>): CheckoutStore {
  return {
    async create(checkout) {
      await db.insert(paymentCheckouts).values(checkout);
    },
    async find(reference) {
      const [row] = await db
        .select({
          reference: paymentCheckouts.reference,
          userId: paymentCheckouts.userId,
          priceId: paymentCheckouts.priceId,
          amountMinor: paymentCheckouts.amountMinor,
          currency: paymentCheckouts.currency,
        })
        .from(paymentCheckouts)
        .where(eq(paymentCheckouts.reference, reference));
      return row;
    },
  };
}
