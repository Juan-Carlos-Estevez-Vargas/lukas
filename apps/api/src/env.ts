/** Variables y bindings disponibles en el Worker (ver wrangler.jsonc). */
export interface Env {
  readonly ENVIRONMENT: "development" | "preview" | "staging" | "production";
  readonly APP_VERSION?: string;
  /** Orígenes permitidos por CORS, separados por comas. */
  readonly CORS_ORIGINS?: string;
  /** Límite general de la API por usuario o IP. */
  readonly API_LIMITER?: RateLimit;
  /** URL pública de la API (base para enlaces y cookies de Better Auth). */
  readonly AUTH_URL?: string;
  /** Dominio de las passkeys (rpID de WebAuthn), p. ej. `lukas.pages.dev`. */
  readonly PASSKEY_RP_ID?: string;
  /** Secreto de Better Auth (`wrangler secret put`), nunca en vars. */
  readonly BETTER_AUTH_SECRET?: string;
  /** Cadena de conexión a Neon (`wrangler secret put`), nunca en vars. */
  readonly DATABASE_URL?: string;
  /** Secreto de Turnstile (`wrangler secret put`); sin él no se exige captcha. */
  readonly TURNSTILE_SECRET_KEY?: string;
  /** Límite estricto para login, registro y recuperación de cuenta. */
  readonly AUTH_LIMITER?: RateLimit;
  /** Cuenta de Cloudflare para la API compatible con OpenAI de Workers AI. */
  readonly CLOUDFLARE_ACCOUNT_ID?: string;
  /** Token con permiso de Workers AI (`wrangler secret put`); sin él el agente está apagado. */
  readonly AI_API_KEY?: string;
  /** Otro proveedor compatible con OpenAI (opcional). */
  readonly AI_BASE_URL?: string;
  readonly AI_MODEL?: string;
  /** Modelo de visión para leer recibos (opcional). */
  readonly AI_VISION_MODEL?: string;
  /** Modelo de embeddings para la búsqueda por significado (opcional). Debe dar 1024 dimensiones. */
  readonly AI_EMBEDDING_MODEL?: string;
  /** Token de acceso de Expo para enviar push (opcional; solo si el proyecto lo exige). */
  readonly EXPO_ACCESS_TOKEN?: string;
  /** URL pública de la web (p. ej. `https://lukas.pages.dev`), para volver del checkout. */
  readonly WEB_APP_URL?: string;
  /** Llave pública de Wompi (`pub_test_…` o `pub_prod_…`); no es secreta, va en vars. */
  readonly WOMPI_PUBLIC_KEY?: string;
  /** Secreto de integridad de Wompi (`wrangler secret put`). Sin las tres llaves, Wompi está apagado. */
  readonly WOMPI_INTEGRITY_SECRET?: string;
  /** Secreto de eventos de Wompi para verificar los webhooks (`wrangler secret put`). */
  readonly WOMPI_EVENTS_SECRET?: string;
}

export interface AppContext {
  Bindings: Env;
  Variables: {
    requestId: string;
    /** Usuario y sesión autenticados; los asigna `sessionContext`. */
    userId?: string;
    sessionId?: string;
  };
}
