import { createRoute, z } from "@hono/zod-openapi";
import type { AppContext } from "../../env";
import { createRouter, problemContent } from "../../http/openapi";
import { HttpProblem } from "../../http/problem";
import type { AuthFactory } from "./factory";
import { requireUser } from "./session";

const MeSchema = z.object({ userId: z.string(), sessionId: z.string() }).openapi("Me");

const meRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["Autenticación"],
  summary: "Usuario de la sesión actual",
  middleware: [requireUser] as const,
  responses: {
    200: { description: "Sesión válida", content: { "application/json": { schema: MeSchema } } },
    401: { description: "Sin sesión", content: problemContent },
  },
});

/** Rutas propias de la API sobre la sesión. */
export const meRoutes = createRouter().openapi(meRoute, (c) =>
  c.json({ userId: c.get("userId") ?? "", sessionId: c.get("sessionId") ?? "" }, 200),
);

/** Monta Better Auth en `/v1/auth/*` (registro, OTP, passkeys, sesiones). */
export const authHandler =
  (factory: AuthFactory) =>
  (c: import("hono").Context<AppContext>): Promise<Response> => {
    const auth = factory(c.env);
    if (!auth) {
      throw new HttpProblem(503, "auth_unavailable", "La autenticación no está configurada");
    }
    return auth.handler(c.req.raw);
  };
