import { createRoute, z } from "@hono/zod-openapi";
import { createRouter, problemContent } from "../../http/openapi";
import { HttpProblem } from "../../http/problem";
import { requireUser } from "../auth/session";
import type { NotificationsFactory } from "./factory";

/** Token de Expo: `ExponentPushToken[...]`. Nada de tokens de FCM o APNs crudos. */
const Token = z
  .string()
  .max(200)
  .regex(/^ExponentPushToken\[[A-Za-z0-9_-]{10,180}\]$/, "Token de Expo inválido");

const DeviceRequest = z
  .object({
    token: Token,
    platform: z.enum(["android", "ios"]),
    weeklySummary: z.boolean(),
  })
  .openapi("PushDevice");

const RemoveRequest = z.object({ token: Token }).openapi("PushDeviceRemove");

const errors = {
  400: { description: "Cuerpo inválido", content: problemContent },
  401: { description: "Sin sesión", content: problemContent },
  503: { description: "Avisos no disponibles", content: problemContent },
} as const;

const registerRoute = createRoute({
  method: "put",
  path: "/notifications/device",
  tags: ["Avisos"],
  summary: "Registra el teléfono para avisos",
  description: "Guarda el token push de Expo del teléfono y sus preferencias de aviso.",
  middleware: [requireUser] as const,
  request: { body: { content: { "application/json": { schema: DeviceRequest } } } },
  responses: { 204: { description: "Registrado" }, ...errors },
});

const removeRoute = createRoute({
  method: "delete",
  path: "/notifications/device",
  tags: ["Avisos"],
  summary: "Deja de enviar avisos a este teléfono",
  description: "Se llama al apagar los avisos o al cerrar sesión.",
  middleware: [requireUser] as const,
  request: { body: { content: { "application/json": { schema: RemoveRequest } } } },
  responses: { 204: { description: "Borrado" }, ...errors },
});

export const notificationRoutes = (backends: NotificationsFactory) => {
  const withBackend = async (
    env: Parameters<NotificationsFactory>[0],
    fn: (b: NonNullable<ReturnType<NotificationsFactory>>) => Promise<void>,
  ) => {
    const backend = backends(env);
    if (!backend) throw new HttpProblem(503, "notifications_unavailable", "Avisos no disponibles");
    try {
      await fn(backend);
    } finally {
      await backend.close().catch(() => undefined);
    }
  };
  return createRouter()
    .openapi(registerRoute, async (c) => {
      const device = c.req.valid("json");
      await withBackend(c.env, (b) => b.devices.register(c.get("userId") ?? "", device));
      return c.body(null, 204);
    })
    .openapi(removeRoute, async (c) => {
      const { token } = c.req.valid("json");
      await withBackend(c.env, (b) => b.devices.remove(c.get("userId") ?? "", token));
      return c.body(null, 204);
    });
};
