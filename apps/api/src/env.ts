/** Variables y bindings disponibles en el Worker (ver wrangler.toml). */
export interface Env {
  readonly ENVIRONMENT: "development" | "preview" | "staging" | "production";
  readonly APP_VERSION?: string;
}

export interface AppContext {
  Bindings: Env;
  Variables: {
    requestId: string;
  };
}
