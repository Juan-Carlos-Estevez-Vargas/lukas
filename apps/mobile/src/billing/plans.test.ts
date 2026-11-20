import { describe, expect, it } from "vitest";
import { cardFixture } from "../accounts/card.test-helper";
import { cachedEntitlements } from "./entitlements";
import { createBillingClient, rememberEntitlements, toBillingStatus } from "./plans";

const API = "https://api.lukas.test";
const trial = {
  plan: "premium",
  features: ["assistant", "receiptReading", "semanticSearch"],
  aiDailyTokens: 100_000,
  aiDailyRequests: 200,
  subscription: { status: "trialing", periodEnd: "2026-12-04T12:00:00.000Z" },
  trialAvailable: false,
};
const free = {
  plan: "free",
  features: ["assistant"],
  aiDailyTokens: 20_000,
  aiDailyRequests: 40,
  subscription: null,
  trialAvailable: true,
};

const problem = (status: number, code: string) => Response.json({ code }, { status });

describe("pantalla de planes", () => {
  it("lee el estado, empieza la prueba y canjea cupones", async () => {
    const calls: { url: string; method: string; body: unknown; auth: string | null }[] = [];
    const replies = [Response.json(free), Response.json(trial), Response.json(trial)];
    const client = createBillingClient(API, async (url, init) => {
      calls.push({
        url,
        method: String(init?.method),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        auth: new Headers(init?.headers).get("authorization"),
      });
      return replies.shift() ?? new Response(null, { status: 500 });
    });
    const status = await client.status("tok");
    expect(status).toMatchObject({ ok: true, value: { trialAvailable: true, subscription: null } });
    const started = await client.startTrial("tok");
    expect(started.ok && started.value.subscription?.status).toBe("trialing");
    expect(started.ok && started.value.subscription?.periodEnd).toEqual(
      new Date("2026-12-04T12:00:00.000Z"),
    );
    await client.redeem("tok", "  beta-2026  ");
    expect(calls.map((c) => [c.method, c.url.replace(API, ""), c.body])).toEqual([
      ["GET", "/v1/billing/entitlements", undefined],
      ["POST", "/v1/billing/trial", undefined],
      ["POST", "/v1/billing/coupons/redeem", { code: "beta-2026" }],
    ]);
    expect(calls.every((c) => c.auth === "Bearer tok")).toBe(true);
  });

  it.each([
    [problem(409, "trial_unavailable"), "trial_unavailable"],
    [problem(404, "coupon_unknown"), "coupon_unknown"],
    [problem(409, "coupon_used"), "coupon_used"],
    [problem(410, "coupon_expired"), "coupon_expired"],
    [problem(410, "coupon_exhausted"), "coupon_exhausted"],
    [problem(429, "rate_limited"), "rate_limited"],
    [problem(418, "tetera"), "unexpected"],
    [new Response("no json", { status: 500 }), "unexpected"],
    [new Response(null, { status: 401 }), "signed_out"],
    [new Response(null, { status: 503 }), "unavailable"],
    [Response.json({ plan: "free" }), "unexpected"],
  ])("traduce los errores de la API (%#)", async (reply, error) => {
    const client = createBillingClient(API, async () => reply);
    expect(await client.redeem("tok", "X")).toEqual({ ok: false, error });
  });

  it("sin red lo dice", async () => {
    const client = createBillingClient(API, async () => Promise.reject(new Error("sin red")));
    expect(await client.status("tok")).toEqual({ ok: false, error: "network" });
  });

  it("valida la suscripción y la prueba", () => {
    expect(toBillingStatus({ ...free, trialAvailable: "sí" })).toBeNull();
    expect(
      toBillingStatus({ ...trial, subscription: { status: "pirata", periodEnd: "x" } }),
    ).toBeNull();
    expect(
      toBillingStatus({ ...trial, subscription: { status: "active", periodEnd: "x" } }),
    ).toBeNull();
    expect(toBillingStatus({ ...trial, subscription: undefined })).toBeNull();
    expect(toBillingStatus(null)).toBeNull();
  });

  it("recuerda el plan nuevo para el resto de la app", async () => {
    const { db } = await cardFixture({ closingDay: null, dueDay: null });
    const status = toBillingStatus(trial);
    if (!status) throw new Error("estado inválido");
    await rememberEntitlements(db, status.entitlements);
    expect((await cachedEntitlements(db)).plan).toBe("premium");
  });
});
