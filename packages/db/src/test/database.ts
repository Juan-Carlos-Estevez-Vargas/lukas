import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../schema";

const migrationsFolder = fileURLToPath(new URL("../../migrations", import.meta.url));

/** Postgres en memoria (PGlite) con todas las migraciones aplicadas. */
export const createTestDatabase = async () => {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return { client, db };
};

export const newId = (): string => randomUUID();

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>["db"];

/** Crea usuarios mínimos para que las FKs `user_id` se cumplan. */
export const insertUsers = async (db: TestDatabase, ...ids: string[]) => {
  await db
    .insert(schema.users)
    .values(ids.map((id) => ({ id, name: id, email: `${id}@lukas.test` })));
};
