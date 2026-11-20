import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { Env } from "../../env";
import { type ConsentStore, postgresConsents } from "./store";

export interface LegalBackend {
  readonly consents: ConsentStore;
  close(): Promise<void>;
}

export type LegalFactory = (env: Env) => LegalBackend | undefined;

export const neonLegalFactory: LegalFactory = (env) => {
  if (!env.DATABASE_URL) return undefined;
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  return { consents: postgresConsents(drizzle({ client: pool })), close: () => pool.end() };
};
