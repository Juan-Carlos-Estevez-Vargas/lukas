import { createRoute, z } from "@hono/zod-openapi";
import { LEGAL_DOCUMENTS, LEGAL_VERSIONS, pendingConsents } from "@lukas/domain";
import { createRouter, problemContent } from "../../http/openapi";
import { HttpProblem } from "../../http/problem";
import { requireUser } from "../auth/session";
import type { LegalBackend, LegalFactory } from "./factory";

const Version = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ConsentStatus = z
  .object({
    current: z.object({ privacy: Version, terms: Version }),
    pending: z.array(z.enum(LEGAL_DOCUMENTS)),
  })
  .openapi("LegalConsentStatus");

const AcceptRequest = z
  .object({ privacy: Version, terms: Version })
  .strict()
  .openapi("LegalConsentAccept");

const errors = {
  401: { description: "Sin sesión", content: problemContent },
  503: { description: "No disponible", content: problemContent },
} as const;

const statusRoute = createRoute({
  method: "get",
  path: "/legal/consents",
  tags: ["Legal"],
  summary: "Qué documentos falta aceptar",
  description:
    "Versiones vigentes de la política de tratamiento de datos y de los términos, y cuáles no ha aceptado la persona.",
  middleware: [requireUser] as const,
  responses: {
    200: { description: "Estado", content: { "application/json": { schema: ConsentStatus } } },
    ...errors,
  },
});

const acceptRoute = createRoute({
  method: "post",
  path: "/legal/consents",
  tags: ["Legal"],
  summary: "Registra la autorización",
  description:
    "Guarda que la persona aceptó estas versiones (prueba de la autorización, Ley 1581). Solo se aceptan las versiones vigentes.",
  middleware: [requireUser] as const,
  request: { body: { content: { "application/json": { schema: AcceptRequest } } } },
  responses: {
    200: { description: "Registrada", content: { "application/json": { schema: ConsentStatus } } },
    400: { description: "Cuerpo inválido", content: problemContent },
    409: { description: "La versión ya no es la vigente", content: problemContent },
    ...errors,
  },
});

async function status(backend: LegalBackend, userId: string) {
  return {
    current: { ...LEGAL_VERSIONS },
    pending: pendingConsents(await backend.consents.list(userId)),
  };
}

export const legalRoutes = (backends: LegalFactory) => {
  const withBackend = async <T>(
    env: Parameters<LegalFactory>[0],
    fn: (b: LegalBackend) => Promise<T>,
  ): Promise<T> => {
    const backend = backends(env);
    if (!backend) throw new HttpProblem(503, "legal_unavailable", "No disponible");
    try {
      return await fn(backend);
    } finally {
      await backend.close().catch(() => undefined);
    }
  };

  return createRouter()
    .openapi(statusRoute, async (c) => {
      const userId = c.get("userId") ?? "";
      c.header("Cache-Control", "no-store");
      return c.json(await withBackend(c.env, (b) => status(b, userId)), 200);
    })
    .openapi(acceptRoute, async (c) => {
      const body = c.req.valid("json");
      if (LEGAL_DOCUMENTS.some((doc) => body[doc] !== LEGAL_VERSIONS[doc])) {
        throw new HttpProblem(
          409,
          "legal_outdated",
          "Los documentos cambiaron",
          "Lee la versión nueva antes de aceptarla.",
        );
      }
      const userId = c.get("userId") ?? "";
      const result = await withBackend(c.env, async (b) => {
        await b.consents.accept(
          userId,
          LEGAL_DOCUMENTS.map((document) => ({ document, version: body[document] })),
        );
        return status(b, userId);
      });
      c.header("Cache-Control", "no-store");
      return c.json(result, 200);
    });
};
