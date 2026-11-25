import type { PGlite } from "@electric-sql/pglite";
import { billingEvents, paymentCheckouts, users } from "@lukas/db/schema";
import { createTestDatabase } from "@lukas/db/testing";
import { Money } from "@lukas/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import type { Env } from "../../env";
import { testEnv } from "../../test/env";
import { createAuth } from "../auth/auth";
import type { Mailer } from "../auth/mailer";
import { postgresCheckouts } from "./checkouts";
import { postgresBilling } from "./store";
import {
  approvedPayment,
  type Checkout,
  checkoutUrl,
  integritySignature,
  newReference,
  sha256Hex,
  verifyEvent,
  WOMPI_CHECKOUT_URL,
  type WompiConfig,
  wompiConfig,
} from "./wompi";

const ORIGIN = "http://localhost:8081";
const env: Env = {
  ...testEnv,
  AUTH_URL: "http://localhost:8787",
  BETTER_AUTH_SECRET: "secreto-de-pruebas-con-mas-de-32-caracteres",
  PASSKEY_RP_ID: "localhost",
  CORS_ORIGINS: ORIGIN,
  WEB_APP_URL: "https://lukas.test/",
  WOMPI_PUBLIC_KEY: "pub_test_abc",
  WOMPI_INTEGRITY_SECRET: "test_integrity_x",
  WOMPI_EVENTS_SECRET: "test_events_y",
};
const config = wompiConfig(env) as WompiConfig;

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

/** Evento firmado como lo firma Wompi. */
async function signedEvent(
  transaction: Record<string, unknown>,
  { secret = config.eventsSecret, environment = "test", timestamp = 1_795_000_000 } = {},
) {
  const properties = ["transaction.id", "transaction.status", "transaction.amount_in_cents"];
  const values = `${transaction.id}${transaction.status}${transaction.amount_in_cents}`;
  const checksum = (await sha256Hex(`${values}${timestamp}${secret}`)).toUpperCase();
  return {
    event: "transaction.updated",
    data: { transaction: { customer_email: "no-guardar@lukas.test", ...transaction } },
    environment,
    signature: { properties, checksum },
    timestamp,
    sent_at: new Date(timestamp * 1000).toISOString(),
  };
}

describe("firmas de Wompi", () => {
  it("se apaga sin las tres llaves y reconoce sandbox o producción", () => {
    expect(wompiConfig({ ...env, WOMPI_EVENTS_SECRET: "" })).toBeUndefined();
    expect(config).toMatchObject({
      environment: "test",
      redirectUrl: "https://lukas.test/premium",
    });
    expect(wompiConfig({ ...env, WOMPI_PUBLIC_KEY: "pub_prod_1", WEB_APP_URL: "" })).toMatchObject({
      environment: "prod",
    });
    expect(wompiConfig({ ...env, WEB_APP_URL: "" })?.redirectUrl).toBeUndefined();
  });

  it("firma la integridad como la documenta Wompi", async () => {
    // Ejemplo de la documentación: "sk8-438k4-xmxm392-sn2m" + 2490000 + COP + secreto.
    expect(
      await integritySignature(
        "sk8-438k4-xmxm392-sn2m",
        2490000n,
        "COP",
        "test_integrity_VMVZ36lyoQot5DsN0fBXAmp4onT5T86G",
      ),
    ).toBe(
      await sha256Hex(
        "sk8-438k4-xmxm392-sn2m2490000COPtest_integrity_VMVZ36lyoQot5DsN0fBXAmp4onT5T86G",
      ),
    );
  });

  it("arma la URL del checkout con monto, referencia y firma", async () => {
    const reference = newReference(() => new Uint8Array(24));
    expect(reference).toBe(`lk${"0".repeat(24)}`);
    expect(newReference()).toMatch(/^lk[0-9a-z]{24}$/);
    const url = new URL(
      await checkoutUrl(config, reference, {
        id: "premium-month",
        plan: "premium",
        period: "month",
        amount: Money.ofMinor(1_490_000n, "COP"),
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(WOMPI_CHECKOUT_URL);
    expect(url.searchParams.get("amount-in-cents")).toBe("1490000");
    expect(url.searchParams.get("currency")).toBe("COP");
    expect(url.searchParams.get("public-key")).toBe("pub_test_abc");
    expect(url.searchParams.get("redirect-url")).toBe("https://lukas.test/premium");
    expect(url.searchParams.get("signature:integrity")).toBe(
      await integritySignature(reference, 1_490_000n, "COP", config.integritySecret),
    );
  });

  it("acepta solo eventos firmados con el secreto y del mismo ambiente", async () => {
    const tx = {
      id: "t1",
      reference: "lkx",
      status: "APPROVED",
      amount_in_cents: 1490000,
      currency: "COP",
    };
    const ok = await verifyEvent(await signedEvent(tx), config);
    expect(ok).toMatchObject({
      kind: "transaction",
      transaction: { id: "t1", amountInCents: 1490000n },
    });
    expect(await verifyEvent(await signedEvent(tx, { secret: "otro" }), config)).toBeNull();
    expect(await verifyEvent(await signedEvent(tx, { environment: "prod" }), config)).toBeNull();
    const tampered = await signedEvent(tx);
    (tampered.data.transaction as Record<string, unknown>).amount_in_cents = 100;
    expect(await verifyEvent(tampered, config)).toBeNull();
    expect(await verifyEvent(null, config)).toBeNull();
    expect(await verifyEvent({ signature: { properties: [], checksum: "x" } }, config)).toBeNull();
    const other = { ...(await signedEvent(tx)), event: "nequi_token.updated" };
    expect(await verifyEvent(other, config)).toEqual({ kind: "other" });
    const proto = await signedEvent(tx);
    proto.signature.properties = ["__proto__.toString"];
    expect(await verifyEvent(proto, config)).toBeNull();
    const broken = await signedEvent({ ...tx, currency: 7 });
    expect(await verifyEvent(broken, config)).toBeNull();
  });

  it("solo un pago aprobado por el monto exacto activa premium y suma al periodo vigente", () => {
    const checkout: Checkout = {
      reference: "lkx",
      userId: "u1",
      priceId: "premium-month",
      amountMinor: 1_490_000n,
      currency: "COP",
    };
    const tx = {
      id: "t1",
      reference: "lkx",
      status: "APPROVED",
      amountInCents: 1_490_000n,
      currency: "COP",
    };
    const at = new Date("2026-11-10T00:00:00Z");
    expect(approvedPayment(checkout, tx, at, undefined)?.event).toEqual({
      type: "payment_succeeded",
      at,
      periodEnd: new Date("2026-12-10T00:00:00Z"),
    });
    expect(
      approvedPayment(checkout, tx, at, new Date("2026-11-20T00:00:00Z"))?.event,
    ).toMatchObject({ periodEnd: new Date("2026-12-20T00:00:00Z") });
    expect(approvedPayment(checkout, { ...tx, status: "DECLINED" }, at, undefined)).toBeNull();
    expect(approvedPayment(checkout, { ...tx, amountInCents: 100n }, at, undefined)).toBeNull();
    expect(approvedPayment(checkout, { ...tx, currency: "USD" }, at, undefined)).toBeNull();
    expect(approvedPayment({ ...checkout, priceId: "viejo" }, tx, at, undefined)).toBeNull();
  });
});

describe("checkout y webhook de Wompi", () => {
  const appWith = (vars: Env = env) =>
    createApp({
      auth: () => createAuth({ db, env: vars, mailer }),
      billing: () => ({
        store: postgresBilling(db),
        checkouts: postgresCheckouts(db),
        close: async () => undefined,
      }),
    });

  const call = (
    app: ReturnType<typeof createApp>,
    path: string,
    token: string | null,
    body: unknown,
    vars: Env = env,
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
        body: JSON.stringify(body),
      },
      vars,
    );

  const signIn = async (app: ReturnType<typeof createApp>, email: string) => {
    await call(app, "/v1/auth/email-otp/send-verification-otp", null, { email, type: "sign-in" });
    const code = mail.findLast((m) => m.to === email)?.code ?? "";
    const res = await call(app, "/v1/auth/sign-in/email-otp", null, { email, otp: code });
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    return { token: res.headers.get("set-auth-token") ?? "", userId: user?.id ?? "" };
  };

  it("un pago aprobado activa premium una sola vez", async () => {
    const app = appWith();
    const { token, userId } = await signIn(app, "wendy@lukas.test");
    const res = await call(app, "/v1/billing/wompi/checkout", token, { priceId: "premium-year" });
    expect(res.status).toBe(200);
    const { url, reference } = (await res.json()) as { url: string; reference: string };
    expect(new URL(url).searchParams.get("reference")).toBe(reference);
    const [saved] = await db
      .select()
      .from(paymentCheckouts)
      .where(eq(paymentCheckouts.reference, reference));
    expect(saved).toMatchObject({ userId, priceId: "premium-year", amountMinor: 14_900_000n });

    const approved = await signedEvent({
      id: "15113-1795000000-1",
      reference,
      status: "APPROVED",
      amount_in_cents: 14900000,
      currency: "COP",
    });
    const hook = (body: unknown) =>
      app.request(
        "http://localhost:8787/v1/billing/wompi/events",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        env,
      );
    expect((await hook(approved)).status).toBe(200);
    expect((await hook(approved)).status).toBe(200);
    expect(await postgresBilling(db).subscription(userId)).toMatchObject({
      status: "active",
      provider: "wompi",
    });
    const events = await db.select().from(billingEvents).where(eq(billingEvents.userId, userId));
    expect(events).toHaveLength(1);

    expect(
      (await hook({ ...approved, signature: { ...approved.signature, checksum: "00" } })).status,
    ).toBe(401);
    // Referencias ajenas o pagos rechazados se reciben sin cambiar nada.
    const unknown = await signedEvent({
      id: "t9",
      reference: "lkdesconocida",
      status: "APPROVED",
      amount_in_cents: 1,
      currency: "COP",
    });
    expect((await hook(unknown)).status).toBe(200);
    const declined = await signedEvent({
      id: "t10",
      reference,
      status: "DECLINED",
      amount_in_cents: 14900000,
      currency: "COP",
    });
    expect((await hook(declined)).status).toBe(200);
    expect(
      await db.select().from(billingEvents).where(eq(billingEvents.userId, userId)),
    ).toHaveLength(1);
  });

  it("sin llaves responde 503 y pide sesión para el checkout", async () => {
    const off: Env = { ...env, WOMPI_PUBLIC_KEY: "" };
    const app = appWith(off);
    expect(
      (await call(app, "/v1/billing/wompi/checkout", null, { priceId: "premium-month" }, off))
        .status,
    ).toBe(401);
    const { token } = await signIn(app, "xavi@lukas.test");
    expect(
      (await call(app, "/v1/billing/wompi/checkout", token, { priceId: "premium-month" }, off))
        .status,
    ).toBe(503);
    expect((await call(app, "/v1/billing/wompi/events", null, {}, off)).status).toBe(503);
    expect(
      (await call(appWith(), "/v1/billing/wompi/checkout", token, { priceId: "gratis" })).status,
    ).toBe(400);
  });
});
