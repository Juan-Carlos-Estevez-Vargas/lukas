import { isUuidV7, uuidv7 } from "@lukas/domain";
import { createMiddleware } from "hono/factory";
import type { AppContext } from "../env";

/** Registro estructurado en JSON; Workers Logs lo indexa por campo. */
export const log = (
  level: "info" | "warn" | "error",
  message: string,
  fields: Record<string, unknown>,
) => {
  const line = JSON.stringify({ level, message, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
};

/**
 * Asigna un identificador a cada petición (respeta uno entrante si es un UUIDv7 válido),
 * lo devuelve en `X-Request-Id` y registra método, ruta, estado y duración.
 * No registra query strings ni cuerpos para no filtrar datos personales.
 */
export const requestContext = createMiddleware<AppContext>(async (c, next) => {
  const incoming = c.req.header("x-request-id");
  const requestId = incoming && isUuidV7(incoming) ? incoming : uuidv7();
  c.set("requestId", requestId);
  const started = Date.now();

  await next();

  c.header("X-Request-Id", requestId);
  const status = c.res.status;
  log(status >= 500 ? "error" : status >= 400 ? "warn" : "info", "request", {
    requestId,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status,
    durationMs: Date.now() - started,
  });
});
