import * as schema from "@lukas/db/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { Env } from "../../env";
import { type Auth, createAuth } from "./auth";
import { consoleMailer, type Mailer, resendMailer } from "./mailer";

/** Devuelve la instancia de autenticación del entorno, o `undefined` si no está configurada. */
export type AuthFactory = (env: Env) => Auth | undefined;

export const missingMailer: Mailer = {
  sendOtp: async () => {
    throw new Error("No hay proveedor de correo configurado");
  },
};

/** Remitente de pruebas de Resend: solo entrega al correo del dueño de la cuenta. */
export const DEFAULT_MAIL_FROM = "Lukas <onboarding@resend.dev>";

/** Consola en desarrollo; Resend si hay llave; si no, un mailer que se niega a enviar. */
export const mailerFor = (env: Env): Mailer => {
  if (env.ENVIRONMENT === "development") return consoleMailer;
  if (env.RESEND_API_KEY)
    return resendMailer(env.RESEND_API_KEY, env.MAIL_FROM || DEFAULT_MAIL_FROM);
  return missingMailer;
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
    mailer: mailerFor(env),
  });
  cache.set(env, auth);
  return auth;
};
