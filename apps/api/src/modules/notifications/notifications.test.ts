import type { PGlite } from "@electric-sql/pglite";
import { accounts, categories, entries, pushDevices, transactions, users } from "@lukas/db/schema";
import { createTestDatabase, newId } from "@lukas/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";
import type { Env } from "../../env";
import { testEnv } from "../../test/env";
import { createAuth } from "../auth/auth";
import type { Mailer } from "../auth/mailer";
import { postgresDevices } from "./devices";
import { isSummaryDay } from "./factory";
import { expoPushSender, type PushMessage } from "./push";
import { pesos, sendWeeklySummaries, summaryText, weeklyMessages, weekWindow } from "./weekly";

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

const appWith = (available = true) =>
  createApp({
    auth: () => createAuth({ db, env, mailer }),
    notifications: () =>
      available ? { devices: postgresDevices(db), close: async () => undefined } : undefined,
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
      body: JSON.stringify(body),
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

async function spend(
  userId: string,
  accountId: string,
  categoryId: string,
  pesos: bigint,
  at: string,
) {
  const id = newId();
  await db.transaction(async (tx) => {
    await tx.insert(transactions).values({ id, userId, occurredAt: new Date(at), description: "" });
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
}

async function wallet(userId: string) {
  const account = newId();
  const mercado = newId();
  const ocio = newId();
  await db
    .insert(accounts)
    .values({ id: account, userId, name: "Nequi", type: "digital_wallet", currency: "COP" });
  await db.insert(categories).values([
    { id: mercado, userId, name: "Mercado", kind: "expense" },
    { id: ocio, userId, name: "Ocio", kind: "expense" },
  ]);
  return { account, mercado, ocio };
}

const tokenOf = (name: string) => `ExponentPushToken[${name}-0123456789]`;
// Domingo 22 de noviembre de 2026, 8:00 de Bogotá: el cron diario de ese día.
const SUNDAY = new Date("2026-11-22T13:00:00Z");

beforeAll(async () => {
  const database = await createTestDatabase();
  client = database.client;
  db = database.db;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

describe("registro de teléfonos", () => {
  it("registra, actualiza y borra solo los propios", async () => {
    const app = appWith();
    const ana = await signIn(app, "ana@lukas.test");
    const device = { token: tokenOf("ana"), platform: "android", weeklySummary: true };
    expect((await call(app, "PUT", "/v1/notifications/device", ana.token, device)).status).toBe(
      204,
    );
    expect(
      (
        await call(app, "PUT", "/v1/notifications/device", ana.token, {
          ...device,
          weeklySummary: false,
        })
      ).status,
    ).toBe(204);
    const rows = await db.select().from(pushDevices).where(eq(pushDevices.userId, ana.userId));
    expect(rows).toMatchObject([{ token: tokenOf("ana"), weeklySummary: false }]);

    // Otra persona no puede borrar el teléfono de Ana aunque conozca el token.
    const beto = await signIn(app, "beto@lukas.test");
    await call(app, "DELETE", "/v1/notifications/device", beto.token, { token: tokenOf("ana") });
    expect(
      await db.select().from(pushDevices).where(eq(pushDevices.userId, ana.userId)),
    ).toHaveLength(1);
    expect(
      (await call(app, "DELETE", "/v1/notifications/device", ana.token, { token: tokenOf("ana") }))
        .status,
    ).toBe(204);
    expect(await db.select().from(pushDevices).where(eq(pushDevices.userId, ana.userId))).toEqual(
      [],
    );
  });

  it("valida sesión, token y disponibilidad", async () => {
    const app = appWith();
    const carla = await signIn(app, "carla@lukas.test");
    const device = { token: tokenOf("carla"), platform: "ios", weeklySummary: true };
    expect((await call(app, "PUT", "/v1/notifications/device", null, device)).status).toBe(401);
    expect(
      (
        await call(app, "PUT", "/v1/notifications/device", carla.token, {
          ...device,
          token: "fcm:abc",
        })
      ).status,
    ).toBe(400);
    expect(
      (await call(appWith(false), "PUT", "/v1/notifications/device", carla.token, device)).status,
    ).toBe(503);
  });
});

describe("resumen semanal", () => {
  it("compara los últimos 7 días con los 7 anteriores y sale los domingos", () => {
    const w = weekWindow(SUNDAY);
    expect(w.start.toISOString()).toBe("2026-11-15T13:00:00.000Z");
    expect(w.previous.toISOString()).toBe("2026-11-08T13:00:00.000Z");
    expect(isSummaryDay(SUNDAY)).toBe(true);
    // Domingo en UTC pero aún sábado en Bogotá.
    expect(isSummaryDay(new Date("2026-11-22T03:00:00Z"))).toBe(false);
    expect(isSummaryDay(new Date("2026-11-23T13:00:00Z"))).toBe(false);
  });

  it("escribe montos y comparaciones", () => {
    expect(pesos(41_000_000n)).toBe("$ 410.000");
    expect(pesos(1_234_567_50n)).toBe("$ 1.234.568");
    expect(pesos(-5000n)).toBe("-$ 50");
    expect(summaryText({ thisWeek: 0n, lastWeek: 10n, top: null }).body).toContain(
      "no registraste",
    );
    expect(summaryText({ thisWeek: 1000n, lastWeek: 1000n, top: null }).body).toBe(
      "En los últimos 7 días gastaste $ 10, igual que los 7 días anteriores.",
    );
    expect(summaryText({ thisWeek: 1100n, lastWeek: 1000n, top: null }).body).toContain("10 % más");
    expect(
      summaryText({ thisWeek: 500n, lastWeek: 0n, top: { name: "Ocio", amount: 500n } }).body,
    ).toBe("En los últimos 7 días gastaste $ 5. Lo que más: Ocio ($ 5).");
  });

  it("arma el resumen de cada teléfono con sus propios números", async () => {
    const app = appWith();
    const dani = await signIn(app, "dani@lukas.test");
    const eva = await signIn(app, "eva@lukas.test");
    const fede = await signIn(app, "fede@lukas.test");
    const d = await wallet(dani.userId);
    await spend(dani.userId, d.account, d.mercado, 230_000n, "2026-11-17T17:00:00Z");
    await spend(dani.userId, d.account, d.ocio, 50_000n, "2026-11-21T17:00:00Z");
    await spend(dani.userId, d.account, d.mercado, 400_000n, "2026-11-10T17:00:00Z");
    await spend(dani.userId, d.account, d.mercado, 999_000n, "2026-10-01T17:00:00Z");
    const e = await wallet(eva.userId);
    await spend(eva.userId, e.account, e.ocio, 80_000n, "2026-11-18T17:00:00Z");

    const devices = postgresDevices(db);
    await devices.register(dani.userId, {
      token: tokenOf("dani"),
      platform: "android",
      weeklySummary: true,
    });
    await devices.register(eva.userId, {
      token: tokenOf("eva"),
      platform: "android",
      weeklySummary: false,
    });
    // El teléfono de Fede fue antes de Dani: solo cuenta el registro más reciente.
    await devices.register(dani.userId, {
      token: tokenOf("fede"),
      platform: "android",
      weeklySummary: true,
    });
    await new Promise((r) => setTimeout(r, 5));
    await devices.register(fede.userId, {
      token: tokenOf("fede"),
      platform: "android",
      weeklySummary: true,
    });

    const messages = await weeklyMessages(db, SUNDAY);
    const byToken = Object.fromEntries(messages.map((m) => [m.to, m.body]));
    expect(byToken[tokenOf("dani")]).toBe(
      "En los últimos 7 días gastaste $ 280.000, 30 % menos que los 7 días anteriores. Lo que más: Mercado ($ 230.000).",
    );
    expect(byToken[tokenOf("fede")]).toContain("no registraste");
    expect(byToken[tokenOf("eva")]).toBeUndefined();
    expect(messages.every((m) => m.title === "Tu semana en Lukas" && m.url === "/reports")).toBe(
      true,
    );

    const sent: PushMessage[] = [];
    const res = await sendWeeklySummaries(
      db,
      {
        send: async (m) => {
          sent.push(...m);
          return { dead: [tokenOf("fede")] };
        },
      },
      SUNDAY,
    );
    expect(res).toEqual({ sent: sent.length, removed: 1 });
    expect(
      await db
        .select()
        .from(pushDevices)
        .where(eq(pushDevices.token, tokenOf("fede"))),
    ).toEqual([]);
  });

  it("sin teléfonos no envía nada", async () => {
    await db.delete(pushDevices);
    const sender = { send: vi.fn() };
    expect(await sendWeeklySummaries(db, sender, SUNDAY)).toEqual({ sent: 0, removed: 0 });
    expect(sender.send).not.toHaveBeenCalled();
  });
});

describe("envío por Expo", () => {
  it("manda en lotes de 100 y reporta los teléfonos que ya no existen", async () => {
    const bodies: unknown[][] = [];
    const headers: Headers[] = [];
    const sender = expoPushSender(async (_url, init) => {
      const batch = JSON.parse(String(init?.body)) as { to: string }[];
      bodies.push(batch);
      headers.push(new Headers(init?.headers));
      return Response.json({
        data: batch.map((m) =>
          m.to.endsWith("7]")
            ? { status: "error", details: { error: "DeviceNotRegistered" } }
            : m.to.endsWith("8]")
              ? { status: "error", details: { error: "MessageRateExceeded" } }
              : { status: "ok" },
        ),
      });
    }, "token-expo");
    const messages = Array.from({ length: 150 }, (_, i) => ({
      to: `ExponentPushToken[t${i}]`,
      title: "t",
      body: "b",
      ...(i === 0 ? { url: "/reports" } : {}),
    }));
    const { dead } = await sender.send(messages);
    expect(bodies.map((b) => b.length)).toEqual([100, 50]);
    expect(bodies[0]?.[0]).toMatchObject({ data: { url: "/reports" }, sound: "default" });
    expect(dead).toEqual([
      "ExponentPushToken[t7]",
      "ExponentPushToken[t17]",
      "ExponentPushToken[t27]",
      "ExponentPushToken[t37]",
      "ExponentPushToken[t47]",
      "ExponentPushToken[t57]",
      "ExponentPushToken[t67]",
      "ExponentPushToken[t77]",
      "ExponentPushToken[t87]",
      "ExponentPushToken[t97]",
      "ExponentPushToken[t107]",
      "ExponentPushToken[t117]",
      "ExponentPushToken[t127]",
      "ExponentPushToken[t137]",
      "ExponentPushToken[t147]",
    ]);
    expect(headers[0]?.get("authorization")).toBe("Bearer token-expo");
  });

  it("falla si Expo no responde bien", async () => {
    const sender = expoPushSender(async () => new Response("", { status: 500 }));
    await expect(sender.send([{ to: "x", title: "t", body: "b" }])).rejects.toThrow(/500/);
    const empty = expoPushSender(async () => Response.json({}));
    expect(await empty.send([{ to: "x", title: "t", body: "b" }])).toEqual({ dead: [] });
  });
});
