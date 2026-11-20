import type { PGlite } from "@electric-sql/pglite";
import { accounts, aiUsage, categories, entries, transactions, users } from "@lukas/db/schema";
import { createTestDatabase, newId } from "@lukas/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";
import type { Env } from "../../env";
import { testEnv } from "../../test/env";
import { createAuth } from "../auth/auth";
import type { Mailer } from "../auth/mailer";
import { postgresAgentData } from "./data";
import { neonAgentFactory } from "./factory";
import { scriptedModel } from "./mock-model";
import { openAiCompatibleModel } from "./model";
import { colombiaDay, DAILY_TOKENS, postgresQuota } from "./quota";

const ORIGIN = "http://localhost:8081";
const env: Env = {
  ...testEnv,
  AUTH_URL: "http://localhost:8787",
  BETTER_AUTH_SECRET: "secreto-de-pruebas-con-mas-de-32-caracteres",
  PASSKEY_RP_ID: "localhost",
  CORS_ORIGINS: ORIGIN,
};

const mail: { to: string; code: string }[] = [];
const mailer: Mailer = {
  sendOtp: async (m) => {
    mail.push(m);
  },
};

type Database = Awaited<ReturnType<typeof createTestDatabase>>;
let client: PGlite;
let db: Database["db"];
let closes = 0;

type Spending = { total: { amount: string }; categories: { name: string; amount: string }[] };
const model = () =>
  scriptedModel("spending_by_category", { from: "2026-11-01", to: "2026-11-30" }, (r) => {
    const s = r as Spending;
    return `Gastaste ${s.total.amount} COP: ${s.categories.map((c) => `${c.name} ${c.amount}`).join(", ")}.`;
  });

const appWith = (withModel = true) =>
  createApp({
    auth: () => createAuth({ db, env, mailer }),
    agent: () => ({
      data: (userId) => postgresAgentData(db, userId),
      quota: postgresQuota(db),
      close: async () => {
        closes += 1;
      },
    }),
    model: () => (withModel ? model() : undefined),
  });

const call = (
  app: ReturnType<typeof createApp>,
  path: string,
  token: string | null,
  body?: unknown,
) =>
  app.request(
    `http://localhost:8787${path}`,
    {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env,
  );

const signIn = async (app: ReturnType<typeof createApp>, email: string) => {
  await call(app, "/v1/auth/email-otp/send-verification-otp", null, { email, type: "sign-in" });
  const code = mail.findLast((m) => m.to === email)?.code ?? "";
  const res = await call(app, "/v1/auth/sign-in/email-otp", null, { email, otp: code });
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return { token: res.headers.get("set-auth-token") ?? "", userId: user?.id ?? "" };
};

/** Un gasto de `pesos` en la categoría, como lo deja el sync (dueño de las tablas, sin RLS). */
async function spend(
  userId: string,
  accountId: string,
  categoryId: string,
  pesos: bigint,
  day: string,
) {
  const id = newId();
  await db.transaction(async (tx) => {
    await tx.insert(transactions).values({
      id,
      userId,
      occurredAt: new Date(`${day}T17:00:00Z`),
      description: "",
      merchant: "Carulla",
    });
    await tx.insert(entries).values([
      {
        id: newId(),
        transactionId: id,
        userId,
        accountId,
        amountMinor: -pesos * 100n,
        currency: "COP",
      },
      {
        id: newId(),
        transactionId: id,
        userId,
        categoryId,
        amountMinor: pesos * 100n,
        currency: "COP",
      },
    ]);
  });
  return id;
}

const chat = (
  app: ReturnType<typeof createApp>,
  token: string,
  content = "¿Cuánto gasté este mes?",
) => call(app, "/v1/agent/chat", token, { messages: [{ role: "user", content }] });

beforeAll(async () => {
  const database = await createTestDatabase();
  client = database.client;
  db = database.db;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

describe("chat con el agente", () => {
  it("responde con los números de la persona y solo de ella", async () => {
    const app = appWith();
    const ana = await signIn(app, "ana@lukas.test");
    const beto = await signIn(app, "beto@lukas.test");
    const nequi = newId();
    const mercado = newId();
    const salario = newId();
    const ajuste = newId();
    await db.insert(accounts).values({
      id: nequi,
      userId: ana.userId,
      name: "Nequi",
      type: "digital_wallet",
      currency: "COP",
    });
    await db.insert(categories).values([
      { id: mercado, userId: ana.userId, name: "Mercado", kind: "expense" },
      { id: salario, userId: ana.userId, name: "Salario", kind: "income" },
      { id: ajuste, userId: ana.userId, name: "Saldo inicial", kind: "equity", isSystem: true },
    ]);
    await spend(ana.userId, nequi, mercado, 230_000n, "2026-11-03");
    await spend(ana.userId, nequi, mercado, 180_000n, "2026-11-10");

    vi.useFakeTimers({ now: new Date("2026-11-20T15:00:00Z"), toFake: ["Date"] });
    try {
      const res = await chat(app, ana.token);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const body = await res.text();
      expect(body).toContain("Gastaste 410000.00 COP: Mercado 410000.00.");

      // Beto pregunta lo mismo y no ve nada de Ana.
      const other = await (await chat(app, beto.token)).text();
      expect(other).toContain("Gastaste 0.00 COP: .");
      const [usage] = await db.select().from(aiUsage).where(eq(aiUsage.userId, ana.userId));
      expect(usage).toMatchObject({ day: "2026-11-20", requests: 1, tokens: 860 });
    } finally {
      vi.useRealTimers();
    }
    expect(closes).toBeGreaterThanOrEqual(2);

    const data = postgresAgentData(db, ana.userId);
    const [account] = await data.accounts();
    expect(account?.balance.toDecimalString()).toBe("-410000.00");
    expect((await data.categories()).map((c) => c.name).sort()).toEqual(["Mercado", "Salario"]);
    expect(await data.movement("no-es-un-uuid")).toBeNull();
    expect(await postgresAgentData(db, beto.userId).accounts()).toEqual([]);
  });

  it("corta al llegar a la cuota diaria", async () => {
    const app = appWith();
    const carla = await signIn(app, "carla@lukas.test");
    await postgresQuota(db).add(carla.userId, colombiaDay(new Date()), {
      tokens: DAILY_TOKENS,
      requests: 1,
    });
    const res = await chat(app, carla.token);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe("agent_quota");
  });

  it("valida la sesión, el cuerpo y la configuración", async () => {
    const app = appWith();
    const dani = await signIn(app, "dani@lukas.test");
    expect((await chat(app, "")).status).toBe(401);
    expect((await call(app, "/v1/agent/chat", dani.token, { messages: [] })).status).toBe(400);
    expect(
      (
        await call(app, "/v1/agent/chat", dani.token, {
          messages: [{ role: "assistant", content: "hola" }],
        })
      ).status,
    ).toBe(400);
    expect((await chat(appWith(false), dani.token)).status).toBe(503);
  });
});

describe("configuración del proveedor", () => {
  it("usa Workers AI con su cuenta o cualquier API compatible con OpenAI", () => {
    expect(openAiCompatibleModel(testEnv)).toBeUndefined();
    expect(openAiCompatibleModel({ ...testEnv, AI_API_KEY: "k" })).toBeUndefined();
    const workers = openAiCompatibleModel({
      ...testEnv,
      AI_API_KEY: "k",
      CLOUDFLARE_ACCOUNT_ID: "abc",
    });
    expect(workers).toMatchObject({ modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" });
    const other = openAiCompatibleModel({
      ...testEnv,
      AI_API_KEY: "k",
      AI_BASE_URL: "https://api.groq.com/openai/v1",
      AI_MODEL: "llama-3.3-70b-versatile",
    });
    expect(other).toMatchObject({ modelId: "llama-3.3-70b-versatile" });
    expect(neonAgentFactory(testEnv)).toBeUndefined();
    const real = neonAgentFactory({ ...testEnv, DATABASE_URL: "postgres://u:p@localhost:1/x" });
    expect(real?.data("u")).toBeDefined();
    void real?.close();
  });
});
