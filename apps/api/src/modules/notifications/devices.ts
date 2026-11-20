import { withUser } from "@lukas/db";
import { pushDevices } from "@lukas/db/schema";
import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { TablesRelationalConfig } from "drizzle-orm/relations";

export interface Device {
  readonly token: string;
  readonly platform: "android" | "ios";
  readonly weeklySummary: boolean;
}

/** Teléfonos de una persona. Todo pasa con RLS: nadie toca filas ajenas. */
export interface DeviceStore {
  register(userId: string, device: Device): Promise<void>;
  remove(userId: string, token: string): Promise<void>;
}

export function postgresDevices<
  Q extends PgQueryResultHKT,
  Full extends Record<string, unknown>,
  Schema extends TablesRelationalConfig,
>(db: PgDatabase<Q, Full, Schema>): DeviceStore {
  return {
    register: (userId, device) =>
      withUser(db, userId, async (tx) => {
        await tx
          .insert(pushDevices)
          .values({ userId, ...device })
          .onConflictDoUpdate({
            target: [pushDevices.userId, pushDevices.token],
            set: {
              platform: device.platform,
              weeklySummary: device.weeklySummary,
              updatedAt: new Date(),
            },
          });
      }),
    remove: (userId, token) =>
      withUser(db, userId, async (tx) => {
        await tx
          .delete(pushDevices)
          .where(and(eq(pushDevices.userId, userId), eq(pushDevices.token, token)));
      }),
  };
}
