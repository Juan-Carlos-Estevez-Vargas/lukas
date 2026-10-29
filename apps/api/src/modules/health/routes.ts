import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "../../http/openapi";

const HealthSchema = z
  .object({
    status: z.literal("ok"),
    environment: z.enum(["development", "preview", "staging", "production"]),
    version: z.string(),
  })
  .openapi("Health");

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["Sistema"],
  summary: "Estado del servicio",
  responses: {
    200: {
      description: "El servicio responde",
      content: { "application/json": { schema: HealthSchema } },
    },
  },
});

/** Estado del servicio. No toca la base de datos para que sea barato y siempre responda. */
export const healthRoutes = createRouter().openapi(healthRoute, (c) =>
  c.json(
    {
      status: "ok" as const,
      environment: c.env.ENVIRONMENT,
      version: c.env.APP_VERSION ?? "dev",
    },
    200,
  ),
);
