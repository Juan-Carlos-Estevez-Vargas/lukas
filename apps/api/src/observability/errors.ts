import { parseDsn, sentryEnvelope, sentryRequest } from "@lukas/domain";
import type { Env } from "../env";

/** Puerto de reporte de errores (FIN-406). Recibe solo errores 5xx, ya sin datos personales. */
export type ErrorReporter = (
  error: unknown,
  context: { readonly where: string; readonly requestId?: string },
) => Promise<void>;

export type ErrorReporterFactory = (env: Env) => ErrorReporter | undefined;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Sentry por HTTP, sin SDK: el sobre se arma en @lukas/domain con todo limpio. Sin `SENTRY_DSN`
 * no se reporta nada. Si Sentry falla, se ignora: reportar nunca debe tumbar una respuesta.
 */
export const sentryReporter =
  (fetchImpl: Fetch = (input, init) => fetch(input, init)): ErrorReporterFactory =>
  (env) => {
    const dsn = parseDsn(env.SENTRY_DSN);
    if (!dsn) return undefined;
    const release = env.APP_VERSION ?? "dev";
    const { url, headers } = sentryRequest(dsn, `lukas-api/${release}`);
    return async (error, { where, requestId }) => {
      const body = sentryEnvelope(
        error,
        {
          service: "api",
          release,
          environment: env.ENVIRONMENT,
          where,
          ...(requestId ? { requestId } : {}),
        },
        new Date(),
      );
      await fetchImpl(url, { method: "POST", headers, body }).catch(() => undefined);
    };
  };
