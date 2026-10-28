import * as schema from "@lukas/db/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { Env } from "../../env";
import { type Auth, createAuth } from "./auth";
import { consoleMailer, type Mailer } from "./mailer";

/** Devuelve la instancia de autenticación del entorno, o `undefined` si no está configurada. */
export type AuthFactory = (env: Env) => Auth | undefined;

export const missingMailer: Mailer = {
  sendOtp: async () => {
    throw new Error("No hay proveedor de correo configurado");
  },
};

// Una instancia por isolate: `env` es el mismo objeto entre solicitudes, así que inicializar
// Better Auth una sola vez ahorra CPU en cada petición.
const cache = new WeakMap<Env, Auth>();

/** Fábrica por defecto: Neon por HTTP (sin conexiones persistentes, apto para Workers). */
export const neonAuthFactory: AuthFactory = (env) => {
  if (!env.DATABASE_URL || !env.BETTER_AUTH_SECRET) return undefined;
  const cached = cache.get(env);
  if (cached) return cached;
  const db = drizzle({ client: neon(env.DATABASE_URL), schema });
  const auth = createAuth({
    db,
    env,
    mailer: env.ENVIRONMENT === "development" ? consoleMailer : missingMailer,
  });
  cache.set(env, auth);
  return auth;
};
