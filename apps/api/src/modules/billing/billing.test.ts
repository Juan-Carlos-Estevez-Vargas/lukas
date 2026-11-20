import type { PGlite } from "@electric-sql/pglite";
import { billingEvents, outbox, subscriptions, users } from "@lukas/db/schema";
import { createTestDatabase, insertUsers } from "@lukas/db/testing";
import type { SubscriptionCommand } from "@lukas/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import type { Env } from "../../env";
import { testEnv } from "../../test/env";
import { createAuth } from "../auth/auth";
import type { Mailer } from "../auth/mailer";
import { neonBillingFactory } from "./factory";
import { requireFeature } from "./gate";
import { postgresBilling } from "./store";

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

const at = (iso: string) => new Date(iso);

const command = (
  userId: string,
  event: SubscriptionCommand["event"],
  provider: SubscriptionCommand["provider"] = "wompi",
): SubscriptionCommand => ({ userId, provider, plan: "premium", event });

describe("saga de la suscripción en Postgres", () => {
  it("aplica cada evento una sola vez y publica el cambio", async () => {
    await insertUsers(db, "u_saga");
    const billing = postgresBilling(db);
    const paid = command("u_saga", {
      type: "payment_succeeded",
      at: at("2026-11-01T00:00:00Z"),
      periodEnd: at("2026-12-01T00:00:00Z"),
    });
    expect(await billing.process("evt_pago", paid, "sub_123")).toBe("changed");
    expect(await billing.process("evt_pago", paid, "sub_123")).toBe("duplicate");

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.userId, "u_saga"));
    expect(row).toMatchObject({ status: "active", plan: "premium", providerRef: "sub_123" });
    const published = await db
      .select()
      .from(outbox)
      .where(eq(outbox.eventType, "SubscriptionChanged"));
    expect(published).toHaveLength(1);
    expect(published[0]?.payload).toMatchObject({ userId: "u_saga", status: "active" });

    const canceled = command("u_saga", {
      type: "renewal_canceled",
      at: at("2026-11-10T00:00:00Z"),
    });
    expect(await billing.process("evt_cancel", canceled)).toBe("changed");
    const old = command("u_saga", { type: "expired", at: at("2026-10-01T00:00:00Z") });
    expect(await billing.process("evt_viejo", old)).toBe("stale");

    const sub = await billing.subscription("u_saga");
    expect(sub).toMatchObject({ status: "canceled", periodEnd: at("2026-12-01T00:00:00Z") });
    expect((await billing.entitlements("u_saga", at("2026-11-20T00:00:00Z"))).plan).toBe("premium");
    expect((await billing.entitlements("u_saga", at("2026-12-01T00:00:00Z"))).plan).toBe("free");

    const [kept] = await db.select().from(subscriptions).where(eq(subscriptions.userId, "u_saga"));
    expect(kept?.providerRef).toBe("sub_123");
    const events = await db
      .select({ eventId: billingEvents.eventId, outcome: billingEvents.outcome })
      .from(billingEvents)
      .where(eq(billingEvents.userId, "u_saga"));
    expect(events.sort((a, b) => a.eventId.localeCompare(b.eventId))).toEqual([
      { eventId: "evt_cancel", outcome: "changed" },
      { eventId: "evt_pago", outcome: "changed" },
      { eventId: "evt_viejo", outcome: "stale" },
    ]);
  });

  it("rechaza lo que no tiene sentido sin tocar la suscripción", async () => {
    await insertUsers(db, "u_nada");
    const billing = postgresBilling(db);
    const failed = command("u_nada", { type: "payment_failed", at: at("2026-11-01T00:00:00Z") });
    expect(await billing.process("evt_x", failed)).toBe("rejected");
    expect(await billing.subscription("u_nada")).toBeUndefined();
    expect((await billing.entitlements("u_nada", new Date())).plan).toBe("free");
  });

  it("los mismos ids de evento en proveedores distintos no chocan", async () => {
    await insertUsers(db, "u_dos");
    const billing = postgresBilling(db);
    const trial = command(
      "u_dos",
      { type: "trial_started", at: at("2026-11-01T00:00:00Z"), endsAt: at("2026-11-15T00:00:00Z") },
      "trial",
    );
    expect(await billing.process("1", trial)).toBe("changed");
    const paid = command("u_dos", {
      type: "payment_succeeded",
      at: at("2026-11-10T00:00:00Z"),
      periodEnd: at("2026-12-10T00:00:00Z"),
    });
    expect(await billing.process("1", paid)).toBe("changed");
    expect(await billing.subscription("u_dos")).toMatchObject({
      status: "active",
      provider: "wompi",
    });
  });
});

describe("GET /billing/entitlements", () => {
  const appWith = (available = true) =>
    createApp({
      auth: () => createAuth({ db, env, mailer }),
      billing: () =>
        available ? { store: postgresBilling(db), close: async () => undefined } : undefined,
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

  it("dice el plan gratis sin suscripción y premium al activarlo en la base", async () => {
    const app = appWith();
    const lina = await signIn(app, "lina@lukas.test");
    const free = await call(app, "GET", "/v1/billing/entitlements", lina.token);
    expect(free.status).toBe(200);
    expect(free.headers.get("cache-control")).toBe("no-store");
    expect(await free.json()).toEqual({
      plan: "free",
      features: ["assistant"],
      aiDailyTokens: 20_000,
      aiDailyRequests: 40,
      subscription: null,
    });

    // Soporte activa premium a mano, directo en la base.
    await db.insert(subscriptions).values({
      userId: lina.userId,
      plan: "premium",
      status: "active",
      provider: "manual",
      periodEnd: at("2099-01-01T00:00:00Z"),
      lastEventAt: at("2026-11-01T00:00:00Z"),
    });
    const premium = await call(app, "GET", "/v1/billing/entitlements", lina.token);
    expect(await premium.json()).toMatchObject({
      plan: "premium",
      features: ["assistant", "receiptReading", "semanticSearch"],
      subscription: { status: "active", periodEnd: "2099-01-01T00:00:00.000Z" },
    });
  });

  it("pide sesión y responde 503 sin base", async () => {
    expect((await call(appWith(), "GET", "/v1/billing/entitlements", null)).status).toBe(401);
    const app = appWith(false);
    const { token } = await signIn(appWith(), "mono@lukas.test");
    expect((await call(app, "GET", "/v1/billing/entitlements", token)).status).toBe(503);
  });
});

describe("piezas sueltas", () => {
  it("el gate deja pasar lo incluido y corta lo demás con 402", () => {
    expect(() =>
      requireFeature(
        { plan: "free", features: ["assistant"], aiDailyTokens: 1, aiDailyRequests: 1 },
        "assistant",
      ),
    ).not.toThrow();
    expect(() =>
      requireFeature(
        { plan: "free", features: ["assistant"], aiDailyTokens: 1, aiDailyRequests: 1 },
        "semanticSearch",
      ),
    ).toThrow(/no incluye semanticSearch/);
  });

  it("sin DATABASE_URL no hay facturación", () => {
    expect(neonBillingFactory({ ...testEnv, DATABASE_URL: "" })).toBeUndefined();
    const backend = neonBillingFactory({ ...testEnv, DATABASE_URL: "postgres://u:p@localhost/db" });
    expect(backend?.store).toBeDefined();
  });
});
