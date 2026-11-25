import type { PGlite } from "@electric-sql/pglite";
import { billingEvents } from "@lukas/db/schema";
import { createTestDatabase, insertUsers } from "@lukas/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import type { Env } from "../../env";
import { testEnv } from "../../test/env";
import { postgresCheckouts } from "./checkouts";
import type { BillingFactory } from "./factory";
import {
  authorized,
  parseEvent,
  type RevenueCatConfig,
  revenueCatConfig,
  toCommand,
} from "./revenuecat";
import { postgresBilling } from "./store";

const SECRET = "rc-webhook-secreto-de-pruebas";
const env: Env = { ...testEnv, REVENUECAT_WEBHOOK_SECRET: SECRET };
const config = revenueCatConfig(env) as RevenueCatConfig;

type Database = Awaited<ReturnType<typeof createTestDatabase>>;
let client: PGlite;
let db: Database["db"];

beforeAll(async () => {
  ({ client, db } = await createTestDatabase());
});

afterAll(async () => {
  await client.close();
});

const T0 = Date.parse("2026-11-20T12:00:00Z");
const DAY = 86_400_000;

const body = (event: Record<string, unknown>) => ({
  api_version: "1.0",
  event: {
    id: "evt-1",
    type: "INITIAL_PURCHASE",
    app_user_id: "u_rc",
    environment: "SANDBOX",
    event_timestamp_ms: T0,
    expiration_at_ms: T0 + 30 * DAY,
    price: 14900,
    country_code: "CO",
    ...event,
  },
});

describe("traducción de RevenueCat", () => {
  it("se apaga sin secreto y en producción solo acepta compras reales", () => {
    expect(revenueCatConfig({ ...env, REVENUECAT_WEBHOOK_SECRET: "" })).toBeUndefined();
    expect(config.environments).toEqual(["SANDBOX", "PRODUCTION"]);
    expect(revenueCatConfig({ ...env, ENVIRONMENT: "production" })?.environments).toEqual([
      "PRODUCTION",
    ]);
  });

  it("exige el encabezado exacto, con o sin Bearer", () => {
    expect(authorized(SECRET, config)).toBe(true);
    expect(authorized(`Bearer ${SECRET}`, config)).toBe(true);
    expect(authorized("Bearer otro", config)).toBe(false);
    expect(authorized(undefined, config)).toBe(false);
  });

  it("lee solo lo necesario y rechaza cuerpos rotos", () => {
    expect(parseEvent(body({}))).toEqual({
      id: "evt-1",
      type: "INITIAL_PURCHASE",
      appUserId: "u_rc",
      at: new Date(T0),
      expiresAt: new Date(T0 + 30 * DAY),
      cancelReason: undefined,
      environment: "SANDBOX",
    });
    expect(parseEvent(null)).toBeNull();
    expect(parseEvent({ event: { id: "x" } })).toBeNull();
    expect(parseEvent(body({ event_timestamp_ms: "ayer" }))).toBeNull();
  });

  it("traduce cada tipo de evento a la saga", () => {
    const cmd = (event: Record<string, unknown>, c: RevenueCatConfig = config) => {
      const parsed = parseEvent(body(event));
      return parsed ? toCommand(parsed, c)?.event : undefined;
    };
    expect(cmd({})).toEqual({
      type: "payment_succeeded",
      at: new Date(T0),
      periodEnd: new Date(T0 + 30 * DAY),
    });
    expect(cmd({ type: "RENEWAL" })?.type).toBe("payment_succeeded");
    expect(cmd({ type: "CANCELLATION", cancel_reason: "UNSUBSCRIBE" })?.type).toBe(
      "renewal_canceled",
    );
    expect(cmd({ type: "CANCELLATION", cancel_reason: "CUSTOMER_SUPPORT" })?.type).toBe("refunded");
    expect(cmd({ type: "BILLING_ISSUE" })?.type).toBe("payment_failed");
    expect(cmd({ type: "EXPIRATION" })?.type).toBe("expired");
    expect(cmd({ type: "TEST" })).toBeUndefined();
    expect(cmd({ type: "TRANSFER" })).toBeUndefined();
    expect(cmd({ app_user_id: "$RCAnonymousID:abc" })).toBeUndefined();
    expect(cmd({ expiration_at_ms: T0 - DAY })).toBeUndefined();
    const prod = revenueCatConfig({ ...env, ENVIRONMENT: "production" }) as RevenueCatConfig;
    expect(cmd({}, prod)).toBeUndefined();
    expect(cmd({ environment: "PRODUCTION" }, prod)?.type).toBe("payment_succeeded");
  });
});

describe("POST /billing/revenuecat/events", () => {
  const billing: BillingFactory = () => ({
    store: postgresBilling(db),
    checkouts: postgresCheckouts(db),
    close: async () => undefined,
  });
  const app = createApp({ billing });
  const hook = (payload: unknown, auth: string | null = `Bearer ${SECRET}`, vars: Env = env) =>
    app.request(
      "http://localhost:8787/v1/billing/revenuecat/events",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: auth } : {}),
        },
        body: JSON.stringify(payload),
      },
      vars,
    );

  it("una compra activa premium una sola vez y la expiración lo quita", async () => {
    await insertUsers(db, "u_rc");
    expect((await hook(body({}))).status).toBe(200);
    expect((await hook(body({}))).status).toBe(200);
    expect(await postgresBilling(db).subscription("u_rc")).toMatchObject({
      status: "active",
      provider: "revenuecat",
      periodEnd: new Date(T0 + 30 * DAY),
    });
    expect(
      await db.select().from(billingEvents).where(eq(billingEvents.userId, "u_rc")),
    ).toHaveLength(1);
    const expired = body({ id: "evt-2", type: "EXPIRATION", event_timestamp_ms: T0 + 31 * DAY });
    expect((await hook(expired)).status).toBe(200);
    expect((await postgresBilling(db).subscription("u_rc"))?.status).toBe("expired");
  });

  it("rechaza sin autorización, con cuerpo roto y responde 503 sin secreto", async () => {
    expect((await hook(body({}), null)).status).toBe(401);
    expect((await hook(body({}), "Bearer mal")).status).toBe(401);
    expect((await hook({ nada: true })).status).toBe(400);
    const off = { ...env, REVENUECAT_WEBHOOK_SECRET: "" };
    expect((await hook(body({}), `Bearer ${SECRET}`, off)).status).toBe(503);
  });

  it("ignora eventos de prueba y personas que ya no existen", async () => {
    expect((await hook(body({ id: "evt-test", type: "TEST" }))).status).toBe(200);
    expect((await hook(body({ id: "evt-x", app_user_id: "u_borrado" }))).status).toBe(200);
    expect(
      await db.select().from(billingEvents).where(eq(billingEvents.eventId, "evt-x")),
    ).toHaveLength(0);
  });
});
