import { createRoute, z } from "@hono/zod-openapi";
import { createRouter, problemContent } from "../../http/openapi";
import { HttpProblem } from "../../http/problem";
import type { RatesFactory } from "./factory";
import { bogotaDay, isDay, trmFor } from "./trm";

const RateSchema = z
  .object({
    base: z.literal("USD"),
    quote: z.literal("COP"),
    /** Día pedido. */
    day: z.string(),
    /** Día de la tasa usada: puede ser anterior si la del día aún no se publica. */
    rateDay: z.string(),
    rate: z.string().openapi({ example: "4012.35" }),
    source: z.string(),
  })
  .openapi("ExchangeRate");

const trmRoute = createRoute({
  method: "get",
  path: "/rates/usd-cop",
  tags: ["Tasas"],
  summary: "TRM (dólar a peso) de un día",
  request: {
    query: z.object({
      day: z
        .string()
        .refine(isDay, "Usa el formato AAAA-MM-DD")
        .optional()
        .openapi({ example: "2026-11-19" }),
    }),
  },
  responses: {
    200: { description: "Tasa del día", content: { "application/json": { schema: RateSchema } } },
    400: { description: "Fecha inválida", content: problemContent },
    404: { description: "No hay tasa para ese día", content: problemContent },
  },
});

/** TRM pública. No requiere sesión: es un dato abierto. */
export const ratesRoutes = (factory: RatesFactory) =>
  createRouter().openapi(trmRoute, async (c) => {
    const day = c.req.valid("query").day ?? bogotaDay(new Date());
    const { source, store } = factory(c.env);
    const rate = await trmFor(source, store, day);
    if (!rate) throw new HttpProblem(404, "rate_not_found", "No hay TRM para ese día");
    c.header("Cache-Control", "public, max-age=3600");
    return c.json(
      {
        base: "USD" as const,
        quote: "COP" as const,
        day,
        rateDay: rate.day,
        rate: rate.rate,
        source: rate.source,
      },
      200,
    );
  });
