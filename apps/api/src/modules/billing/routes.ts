import { createRoute, z } from "@hono/zod-openapi";
import {
  canStartTrial,
  FEATURES,
  normalizeCouponCode,
  PLANS,
  SUBSCRIPTION_STATUSES,
  TRIAL_DAYS,
} from "@lukas/domain";
import { createRouter, problemContent } from "../../http/openapi";
import { HttpProblem } from "../../http/problem";
import { requireUser } from "../auth/session";
import type { BillingBackend, BillingFactory } from "./factory";

const EntitlementsResponse = z
  .object({
    plan: z.enum(PLANS),
    features: z.array(z.enum(FEATURES)),
    aiDailyTokens: z.number().int(),
    aiDailyRequests: z.number().int(),
    subscription: z
      .object({
        status: z.enum(SUBSCRIPTION_STATUSES),
        periodEnd: z.string().datetime(),
      })
      .nullable(),
    /** La persona nunca tuvo suscripción: puede empezar la prueba gratis. */
    trialAvailable: z.boolean(),
  })
  .openapi("Entitlements");

const entitlementsContent = {
  "application/json": { schema: EntitlementsResponse },
} as const;

const entitlementsRoute = createRoute({
  method: "get",
  path: "/billing/entitlements",
  tags: ["Facturación"],
  summary: "Qué puede usar la persona",
  description:
    "Plan vigente, funciones habilitadas y cuota diaria del asistente. Si la suscripción venció, responde con el plan gratis.",
  middleware: [requireUser] as const,
  responses: {
    200: {
      description: "Plan y funciones",
      content: { "application/json": { schema: EntitlementsResponse } },
    },
    401: { description: "Sin sesión", content: problemContent },
    503: { description: "Facturación no disponible", content: problemContent },
  },
});

const trialRoute = createRoute({
  method: "post",
  path: "/billing/trial",
  tags: ["Facturación"],
  summary: "Empieza la prueba gratis de premium",
  description: `Premium por ${TRIAL_DAYS} días, solo para quien nunca tuvo suscripción. Vence sola: no hay que cancelarla.`,
  middleware: [requireUser] as const,
  responses: {
    200: { description: "Prueba activa", content: entitlementsContent },
    401: { description: "Sin sesión", content: problemContent },
    409: { description: "Ya tuvo una suscripción o una prueba", content: problemContent },
    503: { description: "Facturación no disponible", content: problemContent },
  },
});

const CouponRequest = z.object({ code: z.string().max(64) }).openapi("CouponRedeem");

const couponRoute = createRoute({
  method: "post",
  path: "/billing/coupons/redeem",
  tags: ["Facturación"],
  summary: "Canjea un cupón de premium",
  description:
    "Suma los días del cupón a lo que la persona tenga vigente. Un cupón sirve una vez por persona.",
  middleware: [requireUser] as const,
  request: { body: { content: { "application/json": { schema: CouponRequest } } } },
  responses: {
    200: { description: "Cupón canjeado", content: entitlementsContent },
    400: { description: "Cuerpo inválido", content: problemContent },
    401: { description: "Sin sesión", content: problemContent },
    404: { description: "El cupón no existe", content: problemContent },
    409: { description: "Ya lo usaste", content: problemContent },
    410: { description: "Venció o se agotó", content: problemContent },
    503: { description: "Facturación no disponible", content: problemContent },
  },
});

/** Lo que la persona puede usar ahora, con su suscripción si tiene. */
async function snapshot(backend: BillingBackend, userId: string) {
  const now = new Date();
  const subscription = await backend.store.subscription(userId);
  const entitlements = await backend.store.entitlements(userId, now);
  return {
    plan: entitlements.plan,
    features: [...entitlements.features],
    aiDailyTokens: entitlements.aiDailyTokens,
    aiDailyRequests: entitlements.aiDailyRequests,
    subscription: subscription
      ? { status: subscription.status, periodEnd: subscription.periodEnd.toISOString() }
      : null,
    trialAvailable: canStartTrial(subscription),
  };
}

const COUPON_ERRORS = {
  unknown: [404, "coupon_unknown", "Ese cupón no existe"],
  used: [409, "coupon_used", "Ya usaste ese cupón"],
  expired: [410, "coupon_expired", "Ese cupón ya venció"],
  exhausted: [410, "coupon_exhausted", "Ese cupón ya se agotó"],
} as const;

export const billingRoutes = (backends: BillingFactory) => {
  const withBackend = async <T>(
    env: Parameters<BillingFactory>[0],
    fn: (backend: BillingBackend) => Promise<T>,
  ): Promise<T> => {
    const backend = backends(env);
    if (!backend) throw new HttpProblem(503, "billing_unavailable", "Facturación no disponible");
    try {
      return await fn(backend);
    } finally {
      await backend.close().catch(() => undefined);
    }
  };

  return createRouter()
    .openapi(entitlementsRoute, async (c) => {
      const userId = c.get("userId") ?? "";
      const body = await withBackend(c.env, (backend) => snapshot(backend, userId));
      c.header("Cache-Control", "no-store");
      return c.json(body, 200);
    })
    .openapi(trialRoute, async (c) => {
      const userId = c.get("userId") ?? "";
      const body = await withBackend(c.env, async (backend) => {
        const outcome = await backend.store.startTrial(userId, new Date());
        if (outcome !== "changed") {
          throw new HttpProblem(409, "trial_unavailable", "La prueba gratis ya no está disponible");
        }
        return snapshot(backend, userId);
      });
      c.header("Cache-Control", "no-store");
      return c.json(body, 200);
    })
    .openapi(couponRoute, async (c) => {
      const code = normalizeCouponCode(c.req.valid("json").code);
      if (!code) throw new HttpProblem(404, "coupon_unknown", "Ese cupón no existe");
      const userId = c.get("userId") ?? "";
      const body = await withBackend(c.env, async (backend) => {
        const outcome = await backend.store.redeemCoupon(userId, code, new Date());
        if (outcome !== "redeemed") {
          const [status, problem, title] = COUPON_ERRORS[outcome];
          throw new HttpProblem(status, problem, title);
        }
        return snapshot(backend, userId);
      });
      c.header("Cache-Control", "no-store");
      return c.json(body, 200);
    });
};
