import { Hono } from "hono";
import type { AppContext } from "../../env";

/** Estado del servicio. No toca la base de datos para que sea barato y siempre responda. */
export const healthRoutes = new Hono<AppContext>().get("/health", (c) =>
  c.json({
    status: "ok",
    environment: c.env.ENVIRONMENT,
    version: c.env.APP_VERSION ?? "dev",
  }),
);
