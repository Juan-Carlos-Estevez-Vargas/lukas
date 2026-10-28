import { passkey } from "@better-auth/passkey";
import { loginAccounts, passkeys, sessions, users, verifications } from "@lukas/db/schema";
import { uuidv7 } from "@lukas/domain";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins/bearer";
import { emailOTP } from "better-auth/plugins/email-otp";
import type { Env } from "../../env";
import { parseOrigins } from "../../http/security";
import type { Mailer } from "./mailer";

type DrizzleDb = Parameters<typeof drizzleAdapter>[0];

export interface AuthDeps {
  readonly db: DrizzleDb;
  readonly env: Env;
  readonly mailer: Mailer;
}

const DAY = 60 * 60 * 24;

/**
 * Better Auth sin contraseñas: passkeys (WebAuthn) y código de un solo uso por correo.
 * Ambos caben en los 10 ms de CPU del plan gratuito de Workers; un hash de contraseña seguro no.
 * La API valida la sesión por cookie (web) o por `Authorization: Bearer` (app móvil).
 */
export const createAuth = ({ db, env, mailer }: AuthDeps) => {
  // Orígenes de confianza para cookies, passkeys y CSRF: los mismos que CORS.
  const origins = parseOrigins(env.CORS_ORIGINS);
  return betterAuth({
    appName: "Lukas",
    baseURL: env.AUTH_URL,
    basePath: "/v1/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: origins,
    telemetry: { enabled: false },
    // El límite lo aplica el binding de Workers (ver http/rate-limit.ts).
    rateLimit: { enabled: false },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: loginAccounts,
        verification: verifications,
        passkey: passkeys,
      },
    }),
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: 30 * DAY,
      // Renueva la sesión una vez al día de uso: si nadie la usa en 30 días, expira.
      updateAge: DAY,
    },
    advanced: {
      database: { generateId: () => uuidv7() },
      useSecureCookies: env.ENVIRONMENT !== "development",
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        storeOTP: "hashed",
        sendVerificationOTP: async ({ email, otp, type }) => {
          await mailer.sendOtp({ to: email, code: otp, purpose: type });
        },
      }),
      passkey({
        rpID: env.PASSKEY_RP_ID,
        rpName: "Lukas",
        origin: origins,
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      }),
      bearer(),
    ],
  });
};

export type Auth = ReturnType<typeof createAuth>;
