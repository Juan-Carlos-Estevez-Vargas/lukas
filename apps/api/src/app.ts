import { Hono } from "hono";
import type { AppContext } from "./env";
import { notFound, problemResponse } from "./http/problem";
import { log, requestContext } from "./http/request-context";
import { healthRoutes } from "./modules/health/routes";

export const createApp = () => {
  const v1 = new Hono<AppContext>().route("/", healthRoutes);

  const app = new Hono<AppContext>().use(requestContext).route("/", healthRoutes).route("/v1", v1);

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
