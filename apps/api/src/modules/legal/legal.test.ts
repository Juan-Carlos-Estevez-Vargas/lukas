import type { PGlite } from "@electric-sql/pglite";
import { users } from "@lukas/db/schema";
import { createTestDatabase } from "@lukas/db/testing";
import { LEGAL_VERSIONS } from "@lukas/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import type { Env } from "../../env";
import { testEnv } from "../../test/env";
import { createAuth } from "../auth/auth";
import type { Mailer } from "../auth/mailer";
import { neonLegalFactory } from "./factory";
import { postgresConsents } from "./store";

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

type Database = Awaited<ReturnType<typeof createTestDatabase>>;
let client: PGlite;
let db: Database["db"];

beforeAll(async () => {
  ({ client, db } = await createTestDatabase());
});

afterAll(async () => {
  await client.close();
});

const appWith = (available = true) =>
  createApp({
    auth: () => createAuth({ db, env, mailer }),
    legal: () =>
      available ? { consents: postgresConsents(db), close: async () => undefined } : undefined,
  });

const call = (
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
) =>
  app.request(
    `http://localhost:8787${path}`,
    {
      method,
      headers: {
        Origin: ORIGIN,
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );

const signIn = async (app: ReturnType<typeof createApp>, email: string) => {
  await call(app, "POST", "/v1/auth/email-otp/send-verification-otp", null, {
    email,
    type: "sign-in",
  });
  const code = mail.findLast((m) => m.to === email)?.code ?? "";
  const res = await call(app, "POST", "/v1/auth/sign-in/email-otp", null, { email, otp: code });
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return { token: res.headers.get("set-auth-token") ?? "", userId: user?.id ?? "" };
};

describe("autorización de datos", () => {
  it("al registrarse falta todo; al aceptar lo vigente queda registrado", async () => {
    const app = appWith();
    const { token, userId } = await signIn(app, "rosa@lukas.test");
    const before = await call(app, "GET", "/v1/legal/consents", token);
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({
      current: LEGAL_VERSIONS,
      pending: ["privacy", "terms"],
    });

    const accept = await call(app, "POST", "/v1/legal/consents", token, LEGAL_VERSIONS);
    expect(accept.status).toBe(200);
    expect(await accept.json()).toMatchObject({ pending: [] });
    // Aceptar otra vez no duplica ni falla.
    expect((await call(app, "POST", "/v1/legal/consents", token, LEGAL_VERSIONS)).status).toBe(200);
    expect(await postgresConsents(db).list(userId)).toHaveLength(2);

    const other = await signIn(app, "saul@lukas.test");
    const theirs = await call(app, "GET", "/v1/legal/consents", other.token);
    expect(await theirs.json()).toMatchObject({ pending: ["privacy", "terms"] });
  });

  it("no acepta versiones viejas ni campos de más", async () => {
    const app = appWith();
    const { token } = await signIn(app, "tomas@lukas.test");
    const old = await call(app, "POST", "/v1/legal/consents", token, {
      ...LEGAL_VERSIONS,
      privacy: "2020-01-01",
    });
    expect(old.status).toBe(409);
    expect(((await old.json()) as { code: string }).code).toBe("legal_outdated");
    const extra = await call(app, "POST", "/v1/legal/consents", token, {
      ...LEGAL_VERSIONS,
      marketing: "2026-11-20",
    });
    expect(extra.status).toBe(400);
  });

  it("pide sesión y responde 503 sin base", async () => {
    expect((await call(appWith(), "GET", "/v1/legal/consents", null)).status).toBe(401);
    const { token } = await signIn(appWith(), "ursula@lukas.test");
    expect((await call(appWith(false), "GET", "/v1/legal/consents", token)).status).toBe(503);
    expect(neonLegalFactory({ ...testEnv, DATABASE_URL: "" })).toBeUndefined();
    expect(
      neonLegalFactory({ ...testEnv, DATABASE_URL: "postgres://u:p@localhost/db" })?.consents,
    ).toBeDefined();
  });

  it("aceptar una lista vacía no hace nada", async () => {
    await expect(postgresConsents(db).accept("nadie", [])).resolves.toBeUndefined();
  });
});
