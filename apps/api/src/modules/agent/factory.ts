import type { AgentData } from "@lukas/ai-tools";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { Env } from "../../env";
import { postgresAgentData } from "./data";
import { postgresQuota, type QuotaStore } from "./quota";
import { postgresSearch, type SearchStore } from "./search";

export interface AgentBackend {
  /** Datos de una persona, limitados por RLS. */
  data(userId: string): AgentData;
  readonly quota: QuotaStore;
  /** Búsqueda semántica sobre los movimientos de la persona (pgvector + RLS). */
  readonly search?: SearchStore;
  /** Libera la conexión cuando termina la respuesta (el streaming puede durar varios segundos). */
  close(): Promise<void>;
}

export type AgentFactory = (env: Env) => AgentBackend | undefined;

export const neonAgentFactory: AgentFactory = (env) => {
  if (!env.DATABASE_URL) return undefined;
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const db = drizzle({ client: pool });
  return {
    data: (userId) => postgresAgentData(db, userId),
    quota: postgresQuota(db),
    search: postgresSearch(db),
    close: () => pool.end(),
  };
};
