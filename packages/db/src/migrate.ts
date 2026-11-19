/**
 * Aplica las migraciones pendientes en Neon dentro de una transacción (driver WebSocket).
 * Uso: `DATABASE_URL=... pnpm --filter @lukas/db db:migrate`. Lo usan las previews y los despliegues.
 */
import { fileURLToPath } from "node:url";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}

const pool = new Pool({ connectionString: url });
try {
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url).href),
  });
  console.log("Migraciones aplicadas");
} finally {
  await pool.end();
}
