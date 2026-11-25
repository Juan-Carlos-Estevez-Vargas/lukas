import { createRoute, z } from "@hono/zod-openapi";
import { findPrice, PRICES } from "@lukas/domain";
import { createRouter, problemContent } from "../../http/openapi";
import { HttpProblem } from "../../http/problem";
import { log } from "../../http/request-context";
import { requireUser } from "../auth/session";
import type { BillingBackend, BillingFactory } from "./factory";
import { approvedPayment, checkoutUrl, newReference, verifyEvent, wompiConfig } from "./wompi";

const priceIds = PRICES.map((p) => p.id) as [string, ...string[]];

const CheckoutRequest = z
  .object({ priceId: z.enum(priceIds) })
  .strict()
  .openapi("WompiCheckoutRequest");

const CheckoutResponse = z
  .object({ url: z.string().url(), reference: z.string() })
  .openapi("WompiCheckout");

const checkoutRoute = createRoute({
  method: "post",
  path: "/billing/wompi/checkout",
  tags: ["Facturación"],
  summary: "Abre un pago en Wompi",
  description:
    "Crea una referencia de pago para un precio y devuelve la URL del checkout web de Wompi, firmada. Premium se activa cuando llega el webhook del pago aprobado.",
  middleware: [requireUser] as const,
  request: { body: { content: { "application/json": { schema: CheckoutRequest } } } },
  responses: {
    200: { description: "Checkout", content: { "application/json": { schema: CheckoutResponse } } },
    400: { description: "Cuerpo inválido", content: problemContent },
    401: { description: "Sin sesión", content: problemContent },
    503: { description: "Pagos no disponibles", content: problemContent },
  },
});

const eventsRoute = createRoute({
  method: "post",
  path: "/billing/wompi/events",
  tags: ["Facturación"],
  summary: "Webhook de Wompi",
  description:
    "Recibe los eventos de Wompi. Verifica el checksum con el secreto de eventos; un evento repetido no cambia nada.",
  responses: {
    200: { description: "Recibido" },
    401: { description: "Firma inválida", content: problemContent },
    503: { description: "Pagos no disponibles", content: problemContent },
  },
});

const unavailable = () => new HttpProblem(503, "payments_unavailable", "Pagos no disponibles");

export const wompiRoutes = (backends: BillingFactory) => {
  const withBackend = async <T>(
    env: Parameters<BillingFactory>[0],
    fn: (b: BillingBackend) => Promise<T>,
  ): Promise<T> => {
    const backend = backends(env);
    if (!backend) throw unavailable();
    try {
      return await fn(backend);
    } finally {
      await backend.close().catch(() => undefined);
    }
  };

  return createRouter()
    .openapi(checkoutRoute, async (c) => {
      const config = wompiConfig(c.env);
      if (!config) throw unavailable();
      const price = findPrice(c.req.valid("json").priceId);
      if (!price) throw new HttpProblem(400, "price_unknown", "Ese precio no existe");
      const userId = c.get("userId") ?? "";
      const reference = newReference();
      await withBackend(c.env, (b) =>
        b.checkouts.create({
          reference,
          userId,
          priceId: price.id,
          amountMinor: price.amount.amountMinor,
          currency: price.amount.currencyCode,
        }),
      );
      c.header("Cache-Control", "no-store");
      return c.json({ url: await checkoutUrl(config, reference, price), reference }, 200);
    })
    .openapi(eventsRoute, async (c) => {
      const config = wompiConfig(c.env);
      if (!config) throw unavailable();
      const body: unknown = await c.req.json().catch(() => null);
      const event = await verifyEvent(body, config);
      if (!event) throw new HttpProblem(401, "invalid_signature", "Firma inválida");
      if (event.kind !== "transaction") return c.body(null, 200);
      const { transaction, at } = event;
      const outcome = await withBackend(c.env, async (b) => {
        const checkout = await b.checkouts.find(transaction.reference);
        if (!checkout) return "unknown_reference";
        const current = await b.store.subscription(checkout.userId);
        const command = approvedPayment(checkout, transaction, at, current?.periodEnd);
        if (!command) return "ignored";
        return b.store.process(`${transaction.id}:${transaction.status}`, command, transaction.id);
      });
      // Sin datos de la persona: solo ids y resultados.
      log("info", "wompi_event", {
        requestId: c.get("requestId"),
        transactionId: transaction.id,
        status: transaction.status,
        outcome,
      });
      // 200 aunque no aplique: Wompi reintenta todo lo que no sea 200 y no hay nada que corregir.
      return c.body(null, 200);
    });
};
