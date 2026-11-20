import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { Env } from "../../env";
import { type FeedbackStore, postgresFeedback } from "./store";

export interface FeedbackBackend {
  readonly feedback: FeedbackStore;
  close(): Promise<void>;
}

export type FeedbackFactory = (env: Env) => FeedbackBackend | undefined;

export const neonFeedbackFactory: FeedbackFactory = (env) => {
  if (!env.DATABASE_URL) return undefined;
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  return { feedback: postgresFeedback(drizzle({ client: pool })), close: () => pool.end() };
};
