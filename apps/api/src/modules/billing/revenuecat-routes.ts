import { createRoute } from "@hono/zod-openapi";
import { createRouter, problemContent } from "../../http/openapi";
import { HttpProblem } from "../../http/problem";
import { log } from "../../http/request-context";
import type { BillingFactory } from "./factory";
import { authorized, parseEvent, revenueCatConfig, toCommand } from "./revenuecat";

const eventsRoute = createRoute({
  method: "post",
  path: "/billing/revenuecat/events",
  tags: ["Facturación"],
  summary: "Webhook de RevenueCat",
  description:
    "Recibe los eventos de suscripción de Google Play vía RevenueCat. Exige el encabezado Authorization configurado; un evento repetido no cambia nada.",
  responses: {
    200: { description: "Recibido" },
    400: { description: "Cuerpo inválido", content: problemContent },
    401: { description: "Sin autorización", content: problemContent },
    503: { description: "Pagos no disponibles", content: problemContent },
  },
});

const isForeignKeyViolation = (error: unknown): boolean => {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ((e as { code?: unknown }).code === "23503") return true;
  }
  return false;
};

export const revenueCatRoutes = (backends: BillingFactory) =>
  createRouter().openapi(eventsRoute, async (c) => {
    const config = revenueCatConfig(c.env);
    if (!config) throw new HttpProblem(503, "payments_unavailable", "Pagos no disponibles");
    if (!authorized(c.req.header("authorization"), config)) {
      throw new HttpProblem(401, "unauthorized", "Sin autorización");
    }
    const event = parseEvent(await c.req.json().catch(() => null));
    if (!event) throw new HttpProblem(400, "invalid_event", "Evento inválido");
    const command = toCommand(event, config);
    let outcome = "ignored";
    if (command) {
      const backend = backends(c.env);
      if (!backend) throw new HttpProblem(503, "payments_unavailable", "Pagos no disponibles");
      try {
        outcome = await backend.store.process(event.id, command);
      } catch (error) {
        // Una persona que ya no existe (borró su cuenta): no hay nada que reintentar. Cualquier
        // otro error sube como 500 para que RevenueCat reintente.
        if (!isForeignKeyViolation(error)) throw error;
        outcome = "unknown_user";
      } finally {
        await backend.close().catch(() => undefined);
      }
    }
    log("info", "revenuecat_event", {
      requestId: c.get("requestId"),
      eventId: event.id,
      type: event.type,
      outcome,
    });
    return c.body(null, 200);
  });
