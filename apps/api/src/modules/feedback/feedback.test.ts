import type { PGlite } from "@electric-sql/pglite";
import { feedback, users } from "@lukas/db/schema";
import { createTestDatabase } from "@lukas/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import type { Env } from "../../env";
import { testEnv } from "../../test/env";
import { createAuth } from "../auth/auth";
import type { Mailer } from "../auth/mailer";
import { neonFeedbackFactory } from "./factory";
import { postgresFeedback } from "./store";

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
    feedback: () =>
      available ? { feedback: postgresFeedback(db), close: async () => undefined } : undefined,
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

const note = { kind: "bug", appVersion: "0.4.0", platform: "android" } as const;

describe("comentarios de la beta", () => {
  it("guarda el comentario con las tarjetas tapadas", async () => {
    const app = appWith();
    const { token, userId } = await signIn(app, "vera@lukas.test");
    const res = await call(app, "POST", "/v1/feedback", token, {
      ...note,
      message: "  El pago con 4111 1111 1111 1111 no aparece en el resumen  ",
    });
    expect(res.status).toBe(204);
    const rows = await db.select().from(feedback).where(eq(feedback.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "bug",
      message: "El pago con [tarjeta] no aparece en el resumen",
      appVersion: "0.4.0",
      platform: "android",
    });
  });

  it("rechaza mensajes vacíos, campos de más y versiones raras", async () => {
    const app = appWith();
    const { token } = await signIn(app, "walter@lukas.test");
    const empty = await call(app, "POST", "/v1/feedback", token, { ...note, message: "   " });
    expect(empty.status).toBe(422);
    expect(((await empty.json()) as { code: string }).code).toBe("feedback_length");
    const extra = await call(app, "POST", "/v1/feedback", token, {
      ...note,
      message: "Me gusta mucho",
      email: "walter@lukas.test",
    });
    expect(extra.status).toBe(400);
    const odd = await call(app, "POST", "/v1/feedback", token, {
      ...note,
      message: "Me gusta mucho",
      appVersion: "<script>",
    });
    expect(odd.status).toBe(400);
  });

  it("pide sesión y responde 503 sin base", async () => {
    const body = { ...note, message: "Hola, una idea" };
    expect((await call(appWith(), "POST", "/v1/feedback", null, body)).status).toBe(401);
    const { token } = await signIn(appWith(), "ximena@lukas.test");
    expect((await call(appWith(false), "POST", "/v1/feedback", token, body)).status).toBe(503);
    expect(neonFeedbackFactory({ ...testEnv, DATABASE_URL: "" })).toBeUndefined();
    expect(
      neonFeedbackFactory({ ...testEnv, DATABASE_URL: "postgres://u:p@localhost/db" })?.feedback,
    ).toBeDefined();
  });
});
