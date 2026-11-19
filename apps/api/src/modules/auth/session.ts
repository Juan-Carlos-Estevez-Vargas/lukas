import { createMiddleware } from "hono/factory";
import type { AppContext } from "../../env";
import { HttpProblem } from "../../http/problem";
import type { AuthFactory } from "./factory";

/**
 * Resuelve la sesión (cookie o `Authorization: Bearer`) y deja el usuario en `c.var.userId`.
 * Las rutas de Better Auth (`/v1/auth/*`) gestionan su propia sesión.
 */
export const sessionContext = (factory: AuthFactory) =>
  createMiddleware<AppContext>(async (c, next) => {
    const auth = factory(c.env);
    if (auth && !c.req.path.startsWith("/v1/auth/")) {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (session) {
        c.set("userId", session.user.id);
        c.set("sessionId", session.session.id);
      }
    }
    return next();
  });

/** Exige un usuario autenticado. */
export const requireUser = createMiddleware<AppContext>(async (c, next) => {
  if (!c.get("userId"))
    throw new HttpProblem(401, "unauthenticated", "Inicia sesión para continuar");
  return next();
});
