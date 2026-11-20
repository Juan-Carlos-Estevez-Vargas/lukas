import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { Env } from "../../env";
import { type DeviceStore, postgresDevices } from "./devices";
import { expoPushSender } from "./push";
import { sendWeeklySummaries } from "./weekly";

export interface NotificationsBackend {
  readonly devices: DeviceStore;
  close(): Promise<void>;
}

export type NotificationsFactory = (env: Env) => NotificationsBackend | undefined;

export const neonNotificationsFactory: NotificationsFactory = (env) => {
  if (!env.DATABASE_URL) return undefined;
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  return { devices: postgresDevices(drizzle({ client: pool })), close: () => pool.end() };
};

/** Domingo 18:00 de Bogotá (23:00 UTC). Debe coincidir con wrangler.jsonc. */
export const WEEKLY_CRON = "0 23 * * SUN";

/** Cron del domingo: resumen de la semana a cada teléfono con el aviso activado. */
export async function weeklyCron(env: Env, now: Date) {
  if (!env.DATABASE_URL) return { sent: 0, removed: 0 };
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    return await sendWeeklySummaries(
      drizzle({ client: pool }),
      expoPushSender(fetch, env.EXPO_ACCESS_TOKEN),
      now,
    );
  } finally {
    await pool.end();
  }
}
