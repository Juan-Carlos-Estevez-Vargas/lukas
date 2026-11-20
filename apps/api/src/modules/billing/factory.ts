import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { Env } from "../../env";
import { type BillingStore, postgresBilling } from "./store";

export interface BillingBackend {
  readonly store: BillingStore;
  close(): Promise<void>;
}

export type BillingFactory = (env: Env) => BillingBackend | undefined;

export const neonBillingFactory: BillingFactory = (env) => {
  if (!env.DATABASE_URL) return undefined;
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  return { store: postgresBilling(drizzle({ client: pool })), close: () => pool.end() };
};
