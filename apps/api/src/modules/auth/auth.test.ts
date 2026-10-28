import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "@lukas/db/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";
import type { Env } from "../../env";
import { testEnv } from "../../test/env";
import { type Auth, createAuth } from "./auth";
import type { Mailer } from "./mailer";

const ORIGIN = "http://localhost:8081";
const env: Env = {
  ...testEnv,
  AUTH_URL: "http://localhost:8787",
  BETTER_AUTH_SECRET: "secreto-de-pruebas-con-mas-de-32-caracteres",
  PASSKEY_RP_ID: "localhost",
  CORS_ORIGINS: ORIGIN,
};

const outbox: { to: string; code: string; purpose: string }[] = [];
const mailer: Mailer = {
  sendOtp: async (message) => {
    outbox.push(message);
  },
};

let client: PGlite;
let auth: Auth;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const database = await createTestDatabase();
  client = database.client;
  auth = createAuth({ db: database.db, env, mailer });
  app = createApp({ auth: () => auth });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

const post = (path: string, body: unknown, token?: string) =>
  app.request(
    `http://localhost:8787${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    },
    env,
  );

const get = (path: string, token?: string) =>
  app.request(
    `http://localhost:8787${path}`,
    { headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
    env,
  );

/** Pide un código y entra con él; devuelve el token de sesión (bearer). */
const signIn = async (email: string) => {
  const sent = await post("/v1/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
  expect(sent.status).toBe(200);
  const code = outbox.findLast((m) => m.to === email)?.code ?? "";
  const res = await post("/v1/auth/sign-in/email-otp", { email, otp: code });
  expect(res.status).toBe(200);
  const token = res.headers.get("set-auth-token");
  expect(token).toBeTruthy();
  return token ?? "";
};

describe("autenticación sin contraseña", () => {
  it("crea la cuenta con un código por correo y abre sesión", async () => {
    const token = await signIn("ana@lukas.test");
    expect(outbox.at(-1)).toMatchObject({ to: "ana@lukas.test", purpose: "sign-in" });
    expect(outbox.at(-1)?.code).toMatch(/^\d{6}$/);

    const me = await get("/v1/me", token);
    expect(me.status).toBe(200);
    const body = (await me.json()) as { userId: string };
    expect(body.userId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rechaza un código incorrecto y lo invalida tras 3 intentos", async () => {
    const email = "beto@lukas.test";
    await post("/v1/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
    const code = outbox.findLast((m) => m.to === email)?.code ?? "";
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) {
      expect((await post("/v1/auth/sign-in/email-otp", { email, otp: wrong })).status).toBe(400);
    }
    // Agotados los intentos, ni siquiera el código correcto sirve.
    expect((await post("/v1/auth/sign-in/email-otp", { email, otp: code })).status).not.toBe(200);
  });

  it("/v1/me exige sesión", async () => {
    const res = await get("/v1/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "unauthenticated" });
  });

  it("permite cerrar la sesión de otro dispositivo", async () => {
    const email = "carla@lukas.test";
    const phone = await signIn(email);
    const laptop = await signIn(email);

    const list = await get("/v1/auth/list-sessions", phone);
    const sessions = (await list.json()) as { token: string }[];
    expect(sessions).toHaveLength(2);

    // El bearer viaja firmado (`token.firma`); la lista de sesiones expone el token sin firma.
    const laptopSession = sessions.find((s) => laptop.startsWith(`${s.token}.`));
    expect(laptopSession).toBeDefined();
    const revoked = await post("/v1/auth/revoke-session", { token: laptopSession?.token }, phone);
    expect(revoked.status).toBe(200);
    expect((await get("/v1/me", laptop)).status).toBe(401);
    expect((await get("/v1/me", phone)).status).toBe(200);
  });

  it("genera opciones de registro de passkey para el dominio configurado", async () => {
    const token = await signIn("dani@lukas.test");
    const res = await get("/v1/auth/passkey/generate-register-options", token);
    expect(res.status).toBe(200);
    const options = (await res.json()) as {
      rp: { id: string; name: string };
      authenticatorSelection: { userVerification: string };
    };
    expect(options.rp).toEqual({ id: "localhost", name: "Lukas" });
    expect(options.authenticatorSelection.userVerification).toBe("required");
  });

  it("no acepta contraseñas", async () => {
    const res = await post("/v1/auth/sign-up/email", {
      email: "eva@lukas.test",
      password: "una-contraseña-larga",
      name: "Eva",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
