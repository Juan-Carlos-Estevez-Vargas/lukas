import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "@lukas/db/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import type { Env } from "../env";
import { createAuth } from "../modules/auth/auth";
import type { Mailer } from "../modules/auth/mailer";
import { testEnv } from "../test/env";
import { type ErrorReporter, sentryReporter } from "./errors";

const DSN = "https://llave@o1.ingest.sentry.io/42";

let client: PGlite;
let db: Awaited<ReturnType<typeof createTestDatabase>>["db"];

beforeAll(async () => {
  ({ client, db } = await createTestDatabase());
});

afterAll(async () => {
  await client.close();
});

describe("reporte de errores a Sentry", () => {
  it("sin DSN no reporta", () => {
    expect(sentryReporter()({ ...testEnv, SENTRY_DSN: "" })).toBeUndefined();
    expect(sentryReporter()({ ...testEnv, SENTRY_DSN: "no-es-un-dsn" })).toBeUndefined();
  });

  it("manda el sobre limpio y no falla si Sentry no responde", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const report = sentryReporter(fetchImpl)({ ...testEnv, SENTRY_DSN: DSN, APP_VERSION: "0.5.0" });
    await report?.(new Error("falló con ana@lukas.co"), { where: "POST /v1/x", requestId: "r1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://o1.ingest.sentry.io/api/42/envelope/");
    expect(init.headers).toMatchObject({
      "X-Sentry-Auth": "Sentry sentry_version=7, sentry_key=llave, sentry_client=lukas-api/0.5.0",
    });
    expect(String(init.body)).toContain("[correo]");
    expect(String(init.body)).not.toContain("ana@");

    const down = sentryReporter(async () => {
      throw new TypeError("sin red");
    })({ ...testEnv, SENTRY_DSN: DSN });
    await expect(down?.(new Error("x"), { where: "GET /" })).resolves.toBeUndefined();
  });

  it("la API reporta los 5xx con la ruta y no los 4xx", async () => {
    const seen: { error: unknown; where: string; requestId?: string }[] = [];
    const reporter: ErrorReporter = async (error, ctx) => void seen.push({ error, ...ctx });
    const app = createApp({ errors: () => reporter });
    const env: Env = { ...testEnv };
    const res = await app.request("http://localhost/v1/nada", {}, env);
    expect(res.status).toBe(404);
    expect(seen).toHaveLength(0);

    const app500 = createApp({
      errors: () => reporter,
      rates: () => {
        throw new Error("base caída");
      },
    });
    const fail = await app500.request("http://localhost/v1/rates/usd-cop", {}, env);
    expect(fail.status).toBe(500);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.where).toMatch(/^GET \/v1\/rates/);
    expect(seen[0]?.requestId).toBeTruthy();
  });

  it("la ruta de prueba lanza un error fuera de producción y no existe en producción", async () => {
    const seen: unknown[] = [];
    const app = createApp({ errors: () => async (error) => void seen.push(error) });
    const anon = await app.request("http://localhost/v1/debug/error", { method: "POST" }, testEnv);
    expect(anon.status).toBe(401);
    expect(seen).toHaveLength(0);

    const ORIGIN = "http://localhost:8081";
    const env: Env = {
      ...testEnv,
      AUTH_URL: "http://localhost:8787",
      BETTER_AUTH_SECRET: "secreto-de-pruebas-con-mas-de-32-caracteres",
      PASSKEY_RP_ID: "localhost",
      CORS_ORIGINS: ORIGIN,
    };
    const mail: { to: string; code: string }[] = [];
    const mailer: Mailer = { sendOtp: async (m) => void mail.push(m) };
    const signedApp = createApp({
      auth: () => createAuth({ db, env, mailer }),
      errors: () => async (error) => void seen.push(error),
    });
    const post = (path: string, body: unknown, vars: Env, token?: string) =>
      signedApp.request(
        `http://localhost:8787${path}`,
        {
          method: "POST",
          headers: {
            Origin: ORIGIN,
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        },
        vars,
      );
    const email = "debug@lukas.test";
    await post("/v1/auth/email-otp/send-verification-otp", { email, type: "sign-in" }, env);
    const code = mail.findLast((m) => m.to === email)?.code ?? "";
    const signed = await post("/v1/auth/sign-in/email-otp", { email, otp: code }, env);
    const token = signed.headers.get("set-auth-token") ?? "";
    expect((await post("/v1/debug/error", {}, env, token)).status).toBe(500);
    expect(String(seen[0])).toContain("Error de prueba");
    const limiter: RateLimit = { limit: async () => ({ success: true }) };
    const prod: Env = {
      ...env,
      ENVIRONMENT: "production",
      API_LIMITER: limiter,
      AUTH_LIMITER: limiter,
    };
    const r = await post("/v1/debug/error", {}, prod, token);
    expect(r.status).toBe(404);
    expect(seen).toHaveLength(1);
  });
});
