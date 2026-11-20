import { withUser } from "@lukas/db";
import { aiUsage } from "@lukas/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { TablesRelationalConfig } from "drizzle-orm/relations";

/** Tokens por persona y día. Workers AI regala 10.000 neuronas diarias para toda la cuenta. */
export const DAILY_TOKENS = 20_000;
export const DAILY_REQUESTS = 40;

/** Día de Colombia (UTC−5) de un instante, "AAAA-MM-DD". */
export const colombiaDay = (now: Date) =>
  new Date(now.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);

export interface Usage {
  readonly tokens: number;
  readonly requests: number;
}

export interface QuotaStore {
  usage(userId: string, day: string): Promise<Usage>;
  add(userId: string, day: string, usage: Usage): Promise<void>;
}

export const exceeded = (u: Usage) => u.tokens >= DAILY_TOKENS || u.requests >= DAILY_REQUESTS;

export function postgresQuota<
  Q extends PgQueryResultHKT,
  Full extends Record<string, unknown>,
  Schema extends TablesRelationalConfig,
>(db: PgDatabase<Q, Full, Schema>): QuotaStore {
  return {
    usage: (userId, day) =>
      withUser(db, userId, async (tx) => {
        const [row] = await tx
          .select({ tokens: aiUsage.tokens, requests: aiUsage.requests })
          .from(aiUsage)
          .where(and(eq(aiUsage.userId, userId), eq(aiUsage.day, day)));
        return row ?? { tokens: 0, requests: 0 };
      }),
    add: (userId, day, usage) =>
      withUser(db, userId, async (tx) => {
        await tx
          .insert(aiUsage)
          .values({ userId, day, tokens: usage.tokens, requests: usage.requests })
          .onConflictDoUpdate({
            target: [aiUsage.userId, aiUsage.day],
            set: {
              tokens: sql`${aiUsage.tokens} + ${usage.tokens}`,
              requests: sql`${aiUsage.requests} + ${usage.requests}`,
            },
          });
      }),
  };
}
