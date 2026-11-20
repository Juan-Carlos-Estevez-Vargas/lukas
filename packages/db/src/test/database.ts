import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../schema";

const migrationsFolder = fileURLToPath(new URL("../../migrations", import.meta.url).href);

/** Postgres en memoria (PGlite) con todas las migraciones aplicadas. */
export const createTestDatabase = async () => {
  // pgvector para la búsqueda semántica (FIN-310), como en Neon.
  const client = new PGlite({ extensions: { vector } });
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
