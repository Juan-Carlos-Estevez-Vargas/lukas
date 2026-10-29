import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { AppContext } from "../env";
import { HttpProblem } from "./problem";

/** Esquema OpenAPI del cuerpo de error RFC 9457 que devuelven todos los endpoints. */
export const ProblemSchema = z
  .object({
    type: z.url(),
    title: z.string(),
    status: z.int(),
    code: z.string(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    requestId: z.string().optional(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .openapi("Problem");

export const problemContent = {
  "application/problem+json": { schema: ProblemSchema },
} as const;

/**
 * Router con validación Zod. Si la entrada no es válida lanza un HttpProblem 400 con los errores
 * por campo, para que todas las respuestas de error tengan el mismo formato.
 */
export const createRouter = () =>
  new OpenAPIHono<AppContext>({
    defaultHook: (result) => {
      if (!result.success) {
        throw new HttpProblem(
          400,
          "validation_failed",
          "La solicitud no es válida",
          undefined,
          result.error.issues.map((issue) => ({
            path: issue.path.map(String).join("."),
            message: issue.message,
          })),
        );
      }
    },
  });
