import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { Env } from "../../env";
import { type CheckoutStore, postgresCheckouts } from "./checkouts";
import { type BillingStore, postgresBilling } from "./store";

export interface BillingBackend {
  readonly store: BillingStore;
  /** Pagos iniciados en el checkout de Wompi. */
  readonly checkouts: CheckoutStore;
  close(): Promise<void>;
}

export type BillingFactory = (env: Env) => BillingBackend | undefined;

export const neonBillingFactory: BillingFactory = (env) => {
  if (!env.DATABASE_URL) return undefined;
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle({ client: pool });
  return {
    store: postgresBilling(db),
    checkouts: postgresCheckouts(db),
    close: () => pool.end(),
  };
};
