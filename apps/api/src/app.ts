import { Hono } from "hono";
import type { AppContext } from "./env";
import { createRouter } from "./http/openapi";
import { notFound, problemResponse } from "./http/problem";
import { rateLimit } from "./http/rate-limit";
import { log, requestContext } from "./http/request-context";
import { corsPolicy, securityHeaders } from "./http/security";
import { type AgentFactory, neonAgentFactory } from "./modules/agent/factory";
import {
  type EmbedderFactory,
  type ModelFactory,
  openAiCompatibleEmbedder,
  openAiCompatibleModel,
  openAiCompatibleVisionModel,
} from "./modules/agent/model";
import { agentRoutes } from "./modules/agent/routes";
import { type AuthFactory, neonAuthFactory } from "./modules/auth/factory";
import { authHandler, meRoutes } from "./modules/auth/routes";
import { sessionContext } from "./modules/auth/session";
import { type BillingFactory, neonBillingFactory } from "./modules/billing/factory";
import { billingRoutes } from "./modules/billing/routes";
import { healthRoutes } from "./modules/health/routes";
import {
  type NotificationsFactory,
  neonNotificationsFactory,
} from "./modules/notifications/factory";
import { notificationRoutes } from "./modules/notifications/routes";
import { defaultRatesFactory, type RatesFactory } from "./modules/rates/factory";
import { ratesRoutes } from "./modules/rates/routes";
import { securityTxtRoutes } from "./modules/security/routes";
import { neonSyncFactory, type SyncFactory } from "./modules/sync/factory";
import { syncRoutes } from "./modules/sync/routes";

export interface AppDeps {
  /** Permite inyectar la autenticación (p. ej. con PGlite en pruebas). */
  readonly auth?: AuthFactory;
  /** Fuente y almacenamiento de la TRM (en pruebas, falsos en memoria). */
  readonly rates?: RatesFactory;
  /** Almacén del sync (en pruebas, PGlite). */
  readonly sync?: SyncFactory;
  /** Datos y cuota del agente (en pruebas, PGlite o memoria). */
  readonly agent?: AgentFactory;
  /** Modelo de lenguaje (en pruebas, uno simulado). */
  readonly model?: ModelFactory;
  /** Modelo de visión para recibos (en pruebas, uno simulado). */
  readonly vision?: ModelFactory;
  /** Embeddings para la búsqueda por significado (en pruebas, uno simulado). */
  readonly embedder?: EmbedderFactory;
  /** Teléfonos para avisos push (en pruebas, PGlite). */
  readonly notifications?: NotificationsFactory;
  /** Suscripciones y entitlements (en pruebas, PGlite). */
  readonly billing?: BillingFactory;
}

export const createApp = ({
  auth = neonAuthFactory,
  rates = defaultRatesFactory,
  sync = neonSyncFactory,
  agent = neonAgentFactory,
  model = openAiCompatibleModel,
  vision = openAiCompatibleVisionModel,
  notifications = neonNotificationsFactory,
  embedder = openAiCompatibleEmbedder,
  billing = neonBillingFactory,
}: AppDeps = {}) => {
  const v1 = createRouter()
    .route("/", healthRoutes)
    .route("/", meRoutes)
    .route("/", ratesRoutes(rates))
    .route("/", syncRoutes(sync))
    .route("/", agentRoutes(agent, model, vision, embedder))
    .route("/", notificationRoutes(notifications))
    .route("/", billingRoutes(billing));
  v1.doc31("/openapi.json", (c) => ({
    openapi: "3.1.0",
    info: {
      title: "API de Lukas",
      version: c.env.APP_VERSION ?? "dev",
      description: "Finanzas personales para Colombia. Errores en formato RFC 9457.",
    },
    servers: [{ url: `${new URL(c.req.url).origin}/v1` }],
  }));

  const app = new Hono<AppContext>()
    .use(requestContext)
    .use(securityHeaders)
    .use(corsPolicy)
    .use("/v1/*", sessionContext(auth))
    .use("/v1/*", rateLimit("API_LIMITER", 60))
    .use("/v1/auth/*", rateLimit("AUTH_LIMITER", 60))
    .on(["GET", "POST"], "/v1/auth/*", authHandler(auth))
    .route("/", healthRoutes)
    .route("/", securityTxtRoutes)
    .route("/v1", v1);

  app.notFound(notFound);
  app.onError((error, c) => {
    log("error", "unhandled_error", {
      requestId: c.get("requestId"),
      name: error.name,
      message: error.message,
    });
    return problemResponse(c, error);
  });

  return app;
};
