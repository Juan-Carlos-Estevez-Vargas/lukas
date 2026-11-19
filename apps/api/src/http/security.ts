import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import type { AppContext } from "../env";

/** Lista de orígenes de `CORS_ORIGINS`; la usan CORS, las cookies y las passkeys. */
export const parseOrigins = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

/** CORS cerrado: solo los orígenes de `CORS_ORIGINS`. Cualquier otro no recibe cabeceras CORS. */
export const corsPolicy = createMiddleware<AppContext>((c, next) =>
  cors({
    origin: (origin) => (parseOrigins(c.env.CORS_ORIGINS).includes(origin) ? origin : null),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Request-Id"],
    exposeHeaders: ["X-Request-Id", "Retry-After"],
    maxAge: 600,
  })(c, next),
);

/**
 * Cabeceras de seguridad para una API JSON: nada se puede embeber ni ejecutar, y las respuestas
 * con datos financieros no se guardan en cachés intermedias.
 */
export const securityHeaders = createMiddleware<AppContext>(async (c, next) => {
  await secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
    referrerPolicy: "no-referrer",
    permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
  })(c, next);
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
});
