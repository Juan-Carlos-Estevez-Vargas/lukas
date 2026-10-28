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
  /** Límite estricto para login, registro y recuperación de cuenta. */
  readonly AUTH_LIMITER?: RateLimit;
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
