import { createRoute, z } from "@hono/zod-openapi";
import { createRouter, problemContent } from "../../http/openapi";
import { HttpProblem } from "../../http/problem";
import { requireUser } from "../auth/session";
import { runAgent } from "./agent";
import type { AgentBackend, AgentFactory } from "./factory";
import type { ModelFactory } from "./model";
import { colombiaDay, DAILY_REQUESTS, DAILY_TOKENS, exceeded } from "./quota";
import { readReceipt } from "./receipt";

const Message = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(2000),
});

const ChatRequest = z
  .object({
    messages: z
      .array(Message)
      .min(1)
      .max(20)
      .refine((m) => m[m.length - 1]?.role === "user", "El último mensaje debe ser de la persona"),
  })
  .openapi("AgentChat");

const chatRoute = createRoute({
  method: "post",
  path: "/agent/chat",
  tags: ["Agente"],
  summary: "Conversa con el asistente",
  description: `Respuesta en streaming (UI message stream del AI SDK). Cuota diaria: ${DAILY_TOKENS} tokens y ${DAILY_REQUESTS} mensajes por persona. Las propuestas llegan como resultados de herramientas y no se guardan hasta que la persona las aprueba.`,
  middleware: [requireUser] as const,
  request: { body: { content: { "application/json": { schema: ChatRequest } } } },
  responses: {
    200: {
      description: "Stream de la respuesta",
      content: { "text/event-stream": { schema: z.string() } },
    },
    400: { description: "Cuerpo inválido", content: problemContent },
    401: { description: "Sin sesión", content: problemContent },
    429: { description: "Cuota diaria agotada", content: problemContent },
    503: { description: "Agente no disponible", content: problemContent },
  },
});

/** Foto ya comprimida en el teléfono: ~1 MB de JPEG caben de sobra en 1,5 M caracteres. */
const MAX_IMAGE_CHARS = 1_500_000;

const ReceiptRequest = z
  .object({
    image: z
      .string()
      .min(100)
      .max(MAX_IMAGE_CHARS)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, "Debe ser base64"),
    mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  })
  .openapi("AgentReceipt");

const WireMoney = z.object({ amount: z.string(), currency: z.string() });
const ReceiptReading = z
  .object({
    merchant: z.string().nullable(),
    amount: WireMoney.nullable(),
    date: z.string().nullable(),
  })
  .openapi("ReceiptReading");

const receiptRoute = createRoute({
  method: "post",
  path: "/agent/receipt",
  tags: ["Agente"],
  summary: "Lee una foto de recibo",
  description:
    "Devuelve comercio, total y fecha leídos con un modelo de visión. La foto no se guarda ni se registra; la persona revisa lo leído antes de guardar. Cuenta en la misma cuota diaria del asistente.",
  middleware: [requireUser] as const,
  request: { body: { content: { "application/json": { schema: ReceiptRequest } } } },
  responses: {
    200: { description: "Lo leído", content: { "application/json": { schema: ReceiptReading } } },
    400: { description: "Cuerpo inválido", content: problemContent },
    401: { description: "Sin sesión", content: problemContent },
    422: { description: "No se pudo leer el recibo", content: problemContent },
    429: { description: "Cuota diaria agotada", content: problemContent },
    503: { description: "Lectura no disponible", content: problemContent },
  },
});

/** Revisa la cuota del día y cuenta la petición. */
async function chargeRequest(backend: AgentBackend, userId: string, day: string) {
  if (exceeded(await backend.quota.usage(userId, day))) {
    throw new HttpProblem(
      429,
      "agent_quota",
      "Llegaste al límite diario del asistente",
      "Vuelve mañana.",
    );
  }
  await backend.quota.add(userId, day, { tokens: 0, requests: 1 });
}

/** Chat con el agente. El usuario sale de la sesión; los datos, de una conexión con RLS. */
export const agentRoutes = (
  backends: AgentFactory,
  models: ModelFactory,
  visionModels: ModelFactory,
) =>
  createRouter()
    .openapi(receiptRoute, async (c) => {
      const { image, mediaType } = c.req.valid("json");
      const model = visionModels(c.env);
      const backend = model ? backends(c.env) : undefined;
      if (!model || !backend) {
        throw new HttpProblem(503, "agent_unavailable", "La lectura de recibos no está disponible");
      }
      const userId = c.get("userId") ?? "";
      const now = new Date();
      const day = colombiaDay(now);
      try {
        await chargeRequest(backend, userId, day);
        let read: Awaited<ReturnType<typeof readReceipt>>;
        try {
          read = await readReceipt({ model, image, mediaType, now });
        } catch {
          // El detalle del proveedor no se muestra ni se registra (puede traer datos de la foto).
          throw new HttpProblem(503, "agent_unavailable", "No pudimos leer el recibo ahora");
        }
        await backend.quota.add(userId, day, { tokens: read.tokens, requests: 0 });
        const { reading } = read;
        if (!reading.amount && !reading.merchant) {
          throw new HttpProblem(422, "receipt_unreadable", "No se pudo leer el recibo");
        }
        c.header("Cache-Control", "no-store");
        return c.json(reading, 200);
      } finally {
        await backend.close().catch(() => undefined);
      }
    })
    .openapi(chatRoute, async (c) => {
      const { messages } = c.req.valid("json");
      const model = models(c.env);
      const backend = model ? backends(c.env) : undefined;
      if (!model || !backend) {
        throw new HttpProblem(503, "agent_unavailable", "El asistente no está disponible");
      }
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        const closing = backend.close().catch(() => undefined);
        try {
          c.executionCtx.waitUntil(closing);
        } catch {
          // Fuera de un Worker (pruebas) no hay executionCtx.
        }
      };
      const userId = c.get("userId") ?? "";
      const now = new Date();
      const day = colombiaDay(now);
      try {
        await chargeRequest(backend, userId, day);
      } catch (error) {
        close();
        throw error;
      }
      const result = runAgent({
        model,
        data: backend.data(userId),
        messages,
        now,
        onUsage: (tokens) => backend.quota.add(userId, day, { tokens, requests: 0 }),
        onEnd: close,
      });
      return result.toUIMessageStreamResponse({
        headers: { "Cache-Control": "no-store" },
        // El detalle de un error del proveedor no se le muestra a la persona.
        onError: () => "El asistente tuvo un problema. Inténtalo de nuevo.",
      }) as never;
    });
