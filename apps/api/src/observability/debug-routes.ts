import { createRoute } from "@hono/zod-openapi";
import { createRouter, problemContent } from "../http/openapi";
import { HttpProblem } from "../http/problem";
import { requireUser } from "../modules/auth/session";

const forceErrorRoute = createRoute({
  method: "post",
  path: "/debug/error",
  tags: ["Sistema"],
  summary: "Provoca un error de prueba",
  description:
    "Lanza un error a propósito para verificar que llegue a Sentry sin datos personales (FIN-406). Solo fuera de producción y con sesión.",
  middleware: [requireUser] as const,
  responses: {
    401: { description: "Sin sesión", content: problemContent },
    404: { description: "En producción no existe", content: problemContent },
    500: { description: "El error de prueba", content: problemContent },
  },
});

export const debugRoutes = createRouter().openapi(forceErrorRoute, (c) => {
  if (c.env.ENVIRONMENT === "production") {
    throw new HttpProblem(404, "not_found", "Recurso no encontrado");
  }
  // El correo es a propósito: en Sentry debe verse como [correo].
  throw new Error("Error de prueba de Lukas para prueba@lukas.co");
});
