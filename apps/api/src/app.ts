import { Hono } from "hono";
import type { AppContext } from "./env";
import { healthRoutes } from "./modules/health/routes";

export const createApp = () => {
  const v1 = new Hono<AppContext>().route("/", healthRoutes);

  return new Hono<AppContext>().route("/", healthRoutes).route("/v1", v1);
};
