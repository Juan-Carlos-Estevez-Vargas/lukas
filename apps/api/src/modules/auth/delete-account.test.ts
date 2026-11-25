import type { PGlite } from "@electric-sql/pglite";
import { accounts, categories, entries, sessions, transactions, users } from "@lukas/db/schema";
import { createTestDatabase } from "@lukas/db/testing";
import { uuidv7 } from "@lukas/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import type { Env } from "../../env";
import { testEnv } from "../../test/env";
import { createAuth } from "./auth";
import type { Mailer } from "./mailer";

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

const app = () => createApp({ auth: () => createAuth({ db, env, mailer }) });

const call = (method: string, path: string, token: string | null, body?: unknown) =>
  app().request(
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

const signIn = async (email: string) => {
  await call("POST", "/v1/auth/email-otp/send-verification-otp", null, { email, type: "sign-in" });
  const code = mail.findLast((m) => m.to === email)?.code ?? "";
  const res = await call("POST", "/v1/auth/sign-in/email-otp", null, { email, otp: code });
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return { token: res.headers.get("set-auth-token") ?? "", userId: user?.id ?? "" };
};

/** Un gasto de 12 000 COP con su cuenta y su categoría, como lo deja la sincronización. */
const seedMovement = async (userId: string) => {
  const [account] = await db
    .insert(accounts)
    .values({ id: uuidv7(), userId, name: "Nequi", type: "digital_wallet", currency: "COP" })
    .returning({ id: accounts.id });
  const [category] = await db
    .insert(categories)
    .values({ id: uuidv7(), userId, name: "Mercado", kind: "expense" })
    .returning({ id: categories.id });
  await db.transaction(async (tx) => {
    const [movement] = await tx
      .insert(transactions)
      .values({ id: uuidv7(), userId, occurredAt: new Date(), description: "Mercado" })
      .returning({ id: transactions.id });
    await tx.insert(entries).values([
      {
        id: uuidv7(),
        transactionId: movement?.id ?? "",
        userId,
        accountId: account?.id ?? "",
        amountMinor: -1_200_000n,
        currency: "COP",
      },
      {
        id: uuidv7(),
        transactionId: movement?.id ?? "",
        userId,
        categoryId: category?.id ?? "",
        amountMinor: 1_200_000n,
        currency: "COP",
      },
    ]);
  });
};

const count = async (userId: string) => ({
  users: (await db.select().from(users).where(eq(users.id, userId))).length,
  sessions: (await db.select().from(sessions).where(eq(sessions.userId, userId))).length,
  accounts: (await db.select().from(accounts).where(eq(accounts.userId, userId))).length,
  transactions: (await db.select().from(transactions).where(eq(transactions.userId, userId)))
    .length,
  entries: (await db.select().from(entries).where(eq(entries.userId, userId))).length,
});

describe("borrar la cuenta", () => {
  it("borra a la persona y todos sus datos, y deja intactos los de otras", async () => {
    const ana = await signIn("ana.borra@lukas.test");
    const beto = await signIn("beto.queda@lukas.test");
    await seedMovement(ana.userId);
    await seedMovement(beto.userId);
    expect(await count(ana.userId)).toEqual({
      users: 1,
      sessions: 1,
      accounts: 1,
      transactions: 1,
      entries: 2,
    });

    const res = await call("POST", "/v1/auth/delete-user", ana.token, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, message: "User deleted" });

    expect(await count(ana.userId)).toEqual({
      users: 0,
      sessions: 0,
      accounts: 0,
      transactions: 0,
      entries: 0,
    });
    expect((await count(beto.userId)).entries).toBe(2);
    expect((await call("GET", "/v1/me", ana.token)).status).toBe(401);
  });

  it("pide volver a entrar si la sesión tiene más de un día", async () => {
    const carla = await signIn("carla.vieja@lukas.test");
    await db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
      .where(eq(sessions.userId, carla.userId));
    const res = await call("POST", "/v1/auth/delete-user", carla.token, {});
    expect(res.status).toBe(400);
    expect((await count(carla.userId)).users).toBe(1);
  });

  it("no hace nada sin sesión", async () => {
    const res = await call("POST", "/v1/auth/delete-user", null, {});
    expect(res.status).toBe(401);
  });
});
