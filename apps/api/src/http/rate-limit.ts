import { createMiddleware } from "hono/factory";
import type { AppContext, Env } from "../env";
import { HttpProblem, problemResponse } from "./problem";
import { log } from "./request-context";

type LimiterBinding = "API_LIMITER" | "AUTH_LIMITER";

/**
 * Limita solicitudes con el binding de Rate Limiting de Workers. La clave es el usuario si hay
 * sesión y si no la IP del cliente. `periodSeconds` debe coincidir con el `period` del binding
 * en wrangler.jsonc y se devuelve en `Retry-After`.
 */
export const rateLimit = (binding: LimiterBinding, periodSeconds: 10 | 60) =>
  createMiddleware<AppContext>(async (c, next) => {
    const limiter: Env[LimiterBinding] = c.env[binding];
    if (!limiter) {
      // Solo en desarrollo local se permite operar sin el binding; en otro entorno es un error.
      if (c.env.ENVIRONMENT === "development") return next();
      throw new Error(`Falta el binding ${binding}`);
    }

    const userId = c.get("userId");
    const key = userId ? `u:${userId}` : `ip:${c.req.header("cf-connecting-ip") ?? "desconocida"}`;
    const { success } = await limiter.limit({ key });
    if (success) return next();

    log("warn", "rate_limited", { requestId: c.get("requestId"), binding });
    const res = problemResponse(
      c,
      new HttpProblem(
        429,
        "rate_limited",
        "Demasiadas solicitudes",
        `Intenta de nuevo en ${periodSeconds} segundos.`,
      ),
    );
    res.headers.set("Retry-After", String(periodSeconds));
    return res;
  });
