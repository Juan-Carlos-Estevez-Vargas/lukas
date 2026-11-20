import { createRoute, z } from "@hono/zod-openapi";
import {
  MAX_OPS_PER_PUSH,
  PULL_LIMIT,
  parseCursor,
  parsePushRequest,
  SyncValidationError,
} from "@lukas/sync";
import type { Context } from "hono";
import type { AppContext } from "../../env";
import { createRouter, problemContent } from "../../http/openapi";
import { HttpProblem } from "../../http/problem";
import { requireUser } from "../auth/session";
import type { SyncBackend, SyncFactory } from "./factory";

// El esquema detallado vive en @lukas/sync (compartido con las apps); aquí solo se documenta.
const Json = z.record(z.string(), z.unknown());

const pushRoute = createRoute({
  method: "post",
  path: "/sync/push",
  tags: ["Sincronización"],
  summary: "Sube cambios del dispositivo",
  description: `Hasta ${MAX_OPS_PER_PUSH} operaciones. Cada \`opId\` se aplica una sola vez.`,
  middleware: [requireUser] as const,
  request: {
    body: {
      content: {
        "application/json": { schema: z.object({ ops: z.array(Json) }).openapi("SyncPush") },
      },
    },
  },
  responses: {
    200: {
      description: "Resultado de cada operación (applied, duplicate, conflict o rejected)",
      content: { "application/json": { schema: z.object({ results: z.array(Json) }) } },
    },
    400: { description: "Cuerpo inválido", content: problemContent },
    401: { description: "Sin sesión", content: problemContent },
    503: { description: "Sin base de datos", content: problemContent },
  },
});

const pullRoute = createRoute({
  method: "get",
  path: "/sync/pull",
  tags: ["Sincronización"],
  summary: "Trae los cambios desde un cursor",
  middleware: [requireUser] as const,
  request: {
    query: z.object({
      cursor: z.string().optional().openapi({ example: "0" }),
      limit: z.coerce.number().int().min(1).max(PULL_LIMIT).optional(),
    }),
  },
  responses: {
    200: {
      description: "Cambios y cursor siguiente",
      content: {
        "application/json": {
          schema: z.object({ changes: z.array(Json), cursor: z.string(), hasMore: z.boolean() }),
        },
      },
    },
    400: { description: "Cursor inválido", content: problemContent },
    401: { description: "Sin sesión", content: problemContent },
    503: { description: "Sin base de datos", content: problemContent },
  },
});

const withBackend = async <T>(
  c: Context<AppContext>,
  factory: SyncFactory,
  fn: (backend: SyncBackend) => Promise<T>,
): Promise<T> => {
  const backend = factory(c.env);
  if (!backend)
    throw new HttpProblem(503, "sync_unavailable", "La sincronización no está disponible");
  try {
    return await fn(backend);
  } finally {
    const closing = backend.close().catch(() => undefined);
    try {
      c.executionCtx.waitUntil(closing);
    } catch {
      await closing; // Fuera de un Worker (pruebas) no hay executionCtx.
    }
  }
};

/** Push y pull de la sincronización. Siempre con sesión: el usuario sale de ella, nunca del cuerpo. */
export const syncRoutes = (factory: SyncFactory) =>
  createRouter()
    .openapi(pushRoute, async (c) => {
      let request: ReturnType<typeof parsePushRequest>;
      try {
        request = parsePushRequest(await c.req.json());
      } catch (error) {
        if (error instanceof SyncValidationError) {
          throw new HttpProblem(400, "invalid_sync_push", "Operaciones inválidas", undefined, [
            { path: error.path, message: error.message },
          ]);
        }
        throw new HttpProblem(400, "invalid_json", "El cuerpo no es JSON válido");
      }
      const userId = c.get("userId") ?? "";
      const results = await withBackend(c, factory, ({ store }) => store.push(userId, request.ops));
      return c.json({ results: results as unknown as Record<string, unknown>[] }, 200);
    })
    .openapi(pullRoute, async (c) => {
      const { cursor: raw, limit } = c.req.valid("query");
      const cursor = parseCursor(raw);
      if (cursor === null) throw new HttpProblem(400, "invalid_cursor", "Cursor inválido");
      const userId = c.get("userId") ?? "";
      const page = await withBackend(c, factory, ({ store }) =>
        store.pull(userId, cursor, limit ?? PULL_LIMIT),
      );
      c.header("Cache-Control", "no-store");
      return c.json(
        {
          changes: page.changes as unknown as Record<string, unknown>[],
          cursor: page.cursor,
          hasMore: page.hasMore,
        },
        200,
      );
    });
