import { createRoute, z } from "@hono/zod-openapi";
import { cleanFeedback, FEEDBACK_KINDS, FEEDBACK_MAX_LENGTH } from "@lukas/domain";
import { createRouter, problemContent } from "../../http/openapi";
import { HttpProblem } from "../../http/problem";
import { requireUser } from "../auth/session";
import type { FeedbackFactory } from "./factory";

const FeedbackRequest = z
  .object({
    kind: z.enum(FEEDBACK_KINDS),
    // Un poco de margen sobre el límite: la limpieza recorta espacios antes de medir.
    message: z.string().max(FEEDBACK_MAX_LENGTH * 2),
    appVersion: z.string().regex(/^[0-9A-Za-z.+-]{1,32}$/),
    platform: z.enum(["android", "ios", "web"]),
  })
  .strict()
  .openapi("FeedbackRequest");

const sendRoute = createRoute({
  method: "post",
  path: "/feedback",
  tags: ["Beta"],
  summary: "Envía un comentario",
  description:
    "Guarda un comentario de la beta (falla, idea u otro). Los números de tarjeta se tapan antes de guardar.",
  middleware: [requireUser] as const,
  request: { body: { content: { "application/json": { schema: FeedbackRequest } } } },
  responses: {
    204: { description: "Recibido" },
    400: { description: "Cuerpo inválido", content: problemContent },
    401: { description: "Sin sesión", content: problemContent },
    422: { description: "Mensaje muy corto o muy largo", content: problemContent },
    503: { description: "No disponible", content: problemContent },
  },
});

export const feedbackRoutes = (backends: FeedbackFactory) =>
  createRouter().openapi(sendRoute, async (c) => {
    const body = c.req.valid("json");
    const message = cleanFeedback(body.message);
    if (!message) {
      throw new HttpProblem(
        422,
        "feedback_length",
        "El mensaje no tiene el largo esperado",
        "Escribe entre 5 y 2000 caracteres.",
      );
    }
    const backend = backends(c.env);
    if (!backend) throw new HttpProblem(503, "feedback_unavailable", "No disponible");
    try {
      await backend.feedback.add(c.get("userId") ?? "", { ...body, message });
    } finally {
      await backend.close().catch(() => undefined);
    }
    return c.body(null, 204);
  });
