import { createRoute, z } from "@hono/zod-openapi";
import { FEATURES, PLANS, SUBSCRIPTION_STATUSES } from "@lukas/domain";
import { createRouter, problemContent } from "../../http/openapi";
import { HttpProblem } from "../../http/problem";
import { requireUser } from "../auth/session";
import type { BillingFactory } from "./factory";

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
  })
  .openapi("Entitlements");

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

export const billingRoutes = (backends: BillingFactory) =>
  createRouter().openapi(entitlementsRoute, async (c) => {
    const backend = backends(c.env);
    if (!backend) throw new HttpProblem(503, "billing_unavailable", "Facturación no disponible");
    const userId = c.get("userId") ?? "";
    try {
      const now = new Date();
      const subscription = await backend.store.subscription(userId);
      const entitlements = await backend.store.entitlements(userId, now);
      c.header("Cache-Control", "no-store");
      return c.json(
        {
          plan: entitlements.plan,
          features: [...entitlements.features],
          aiDailyTokens: entitlements.aiDailyTokens,
          aiDailyRequests: entitlements.aiDailyRequests,
          subscription: subscription
            ? { status: subscription.status, periodEnd: subscription.periodEnd.toISOString() }
            : null,
        },
        200,
      );
    } finally {
      await backend.close().catch(() => undefined);
    }
  });
