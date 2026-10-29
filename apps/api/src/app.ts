import { Hono } from "hono";
import type { AppContext } from "./env";
import { createRouter } from "./http/openapi";
import { notFound, problemResponse } from "./http/problem";
import { rateLimit } from "./http/rate-limit";
import { log, requestContext } from "./http/request-context";
import { corsPolicy, securityHeaders } from "./http/security";
import { type AuthFactory, neonAuthFactory } from "./modules/auth/factory";
import { authHandler, meRoutes } from "./modules/auth/routes";
import { sessionContext } from "./modules/auth/session";
import { healthRoutes } from "./modules/health/routes";

export interface AppDeps {
  /** Permite inyectar la autenticación (p. ej. con PGlite en pruebas). */
  readonly auth?: AuthFactory;
}

export const createApp = ({ auth = neonAuthFactory }: AppDeps = {}) => {
  const v1 = createRouter().route("/", healthRoutes).route("/", meRoutes);
  v1.doc31("/openapi.json", (c) => ({
    openapi: "3.1.0",
    info: {
      title: "API de Lukas",
      version: c.env.APP_VERSION ?? "dev",
      description: "Finanzas personales para Colombia. Errores en formato RFC 9457.",
    },
    servers: [{ url: `${new URL(c.req.url).origin}/v1` }],
  }));

  const app = new Hono<AppContext>()
    .use(requestContext)
    .use(securityHeaders)
    .use(corsPolicy)
    .use("/v1/*", sessionContext(auth))
    .use("/v1/*", rateLimit("API_LIMITER", 60))
    .use("/v1/auth/*", rateLimit("AUTH_LIMITER", 60))
    .on(["GET", "POST"], "/v1/auth/*", authHandler(auth))
    .route("/", healthRoutes)
    .route("/v1", v1);

  app.notFound(notFound);
  app.onError((error, c) => {
    log("error", "unhandled_error", {
      requestId: c.get("requestId"),
      name: error.name,
      message: error.message,
    });
    return problemResponse(c, error);
  });

  return app;
};
