/** Variables y bindings disponibles en el Worker (ver wrangler.jsonc). */
export interface Env {
  readonly ENVIRONMENT: "development" | "preview" | "staging" | "production";
  readonly APP_VERSION?: string;
  /** Orígenes permitidos por CORS, separados por comas. */
  readonly CORS_ORIGINS?: string;
  /** Límite general de la API por usuario o IP. */
  readonly API_LIMITER?: RateLimit;
  /** Límite estricto para login, registro y recuperación de cuenta. */
  readonly AUTH_LIMITER?: RateLimit;
}

export interface AppContext {
  Bindings: Env;
  Variables: {
    requestId: string;
    /** Usuario autenticado; lo asigna el middleware de sesión (FIN-009). */
    userId?: string;
  };
}
