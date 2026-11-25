/**
 * Telemetría sin datos personales (FIN-406): errores a Sentry y uso a PostHog. Lo que sale del
 * teléfono o de la API pasa antes por aquí. Nada de correos, tarjetas, celulares, cédulas ni
 * montos con nombre de comercio: solo el tipo de error, un mensaje limpio y de dónde salió.
 */
import { maskCardNumbers } from "./feedback";
import { type RandomSource, uuidv7 } from "./id";

const RULES: readonly [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[correo]"],
  // Tokens de sesión, llaves y JWT que se cuelan en mensajes ("Bearer abc…", "eyJ…").
  [/\bBearer\s+[\w.~+/=-]+/gi, "Bearer [token]"],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]"],
  // Celulares de Colombia: 3xx xxx xxxx, con o sin +57.
  [/(?:\+?57[ -]?)?\b3\d{2}[ -]?\d{3}[ -]?\d{4}\b/g, "[celular]"],
  // Cédulas, cuentas y montos largos: 6 o más dígitos seguidos.
  [/\d[\d.,]{5,}\d/g, "[número]"],
];

/** Limpia un texto libre (mensaje de error, nombre de pantalla) antes de enviarlo. */
export function scrubText(text: string, maxLength = 500): string {
  const masked = maskCardNumbers(text);
  return RULES.reduce((t, [pattern, label]) => t.replace(pattern, label), masked).slice(
    0,
    maxLength,
  );
}

/** Quita query string y fragmento de una URL o ruta: ahí suelen viajar correos y códigos. */
export function scrubUrl(url: string): string {
  return scrubText(url.split(/[?#]/, 1)[0] ?? "");
}

/** Partes de un DSN de Sentry: `https://<llave>@<host>/<proyecto>`. */
export interface SentryDsn {
  readonly origin: string;
  readonly publicKey: string;
  readonly projectId: string;
}

export function parseDsn(dsn: string | undefined): SentryDsn | null {
  const m = /^https:\/\/([\w-]+)(?::[^@/]*)?@([\w.-]+(?::\d+)?)\/(\d+)\/?$/.exec(dsn ?? "");
  if (!m?.[1] || !m[2] || !m[3]) return null;
  return { origin: `https://${m[2]}`, publicKey: m[1], projectId: m[3] };
}

export interface ErrorContext {
  /** "api" o "mobile". */
  readonly service: string;
  readonly release: string;
  readonly environment: string;
  /** Ruta o pantalla, sin query string. */
  readonly where?: string;
  readonly requestId?: string;
  readonly platform?: string;
}

/** Traza limpia: solo nombres de función y archivos, sin rutas locales largas ni datos. */
function cleanStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  return scrubText(
    stack
      .split("\n")
      .slice(1, 16)
      .map((line) => line.trim())
      .join("\n"),
    2000,
  );
}

/**
 * Arma el sobre (envelope) que recibe Sentry en `/api/<proyecto>/envelope/`. No lleva usuario,
 * IP, cookies ni encabezados: Sentry igual debe tener "Prevent storing of IP addresses" activado.
 */
export function sentryEnvelope(
  error: unknown,
  context: ErrorContext,
  now: Date,
  random?: RandomSource,
): string {
  const eventId = uuidv7(() => now.getTime(), random).replace(/-/g, "");
  const e = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Error");
  const event = {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform: "javascript",
    level: "error",
    release: context.release,
    environment: context.environment,
    server_name: context.service,
    tags: {
      service: context.service,
      ...(context.platform ? { platform: context.platform } : {}),
      ...(context.where ? { where: scrubUrl(context.where) } : {}),
    },
    ...(context.requestId ? { extra: { requestId: context.requestId } } : {}),
    exception: {
      values: [
        {
          type: scrubText(e.name, 100),
          value: scrubText(e.message),
          ...(cleanStack(e.stack) ? { mechanism: { type: "generic", handled: false } } : {}),
        },
      ],
    },
    ...(cleanStack(e.stack) ? { contexts: { trace_text: { stack: cleanStack(e.stack) } } } : {}),
  };
  const header = { event_id: eventId, sent_at: now.toISOString() };
  return `${JSON.stringify(header)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}`;
}

/** URL y encabezados para mandar un sobre a Sentry. */
export function sentryRequest(dsn: SentryDsn, client: string) {
  return {
    url: `${dsn.origin}/api/${dsn.projectId}/envelope/`,
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=${client}`,
    },
  };
}

/**
 * Eventos del embudo de activación. Solo nombres fijos: nunca montos, comercios ni textos que
 * escribió la persona.
 */
export const ANALYTICS_EVENTS = [
  "app_opened",
  "signed_in",
  "onboarding_completed",
  "first_movement",
  "movement_created",
  "premium_viewed",
  "premium_started",
  "feedback_sent",
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/** Propiedades permitidas en un evento: valores cortos, sin texto libre. */
export type AnalyticsProperties = Readonly<Record<string, string | number | boolean>>;

export function cleanProperties(props: AnalyticsProperties = {}): AnalyticsProperties {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props).slice(0, 20)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) continue;
    out[key] = typeof value === "string" ? scrubText(value, 60) : value;
  }
  return out;
}
