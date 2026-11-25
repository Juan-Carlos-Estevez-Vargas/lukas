import { addPeriod, findPrice, type Price, type SubscriptionCommand } from "@lukas/domain";
import type { Env } from "../../env";

/**
 * Adaptador de Wompi (FIN-402): checkout web con firma de integridad y webhook con checksum.
 * Solo traduce: la saga de la suscripción no sabe nada de Wompi.
 * Docs: https://docs.wompi.co/docs/colombia/widget-checkout-web/ y /eventos/
 */
export interface WompiConfig {
  readonly publicKey: string;
  readonly integritySecret: string;
  readonly eventsSecret: string;
  /** "test" en sandbox (llaves `pub_test_`), "prod" en producción. */
  readonly environment: "test" | "prod";
  /** A dónde vuelve la persona después de pagar (la pantalla de planes de la web). */
  readonly redirectUrl?: string;
}

export const WOMPI_CHECKOUT_URL = "https://checkout.wompi.co/p/";

/** Lee la configuración del entorno; `undefined` si falta alguna llave (Wompi apagado). */
export function wompiConfig(env: Env): WompiConfig | undefined {
  const { WOMPI_PUBLIC_KEY, WOMPI_INTEGRITY_SECRET, WOMPI_EVENTS_SECRET } = env;
  if (!WOMPI_PUBLIC_KEY || !WOMPI_INTEGRITY_SECRET || !WOMPI_EVENTS_SECRET) return undefined;
  return {
    publicKey: WOMPI_PUBLIC_KEY,
    integritySecret: WOMPI_INTEGRITY_SECRET,
    eventsSecret: WOMPI_EVENTS_SECRET,
    environment: WOMPI_PUBLIC_KEY.startsWith("pub_prod_") ? "prod" : "test",
    ...(env.WEB_APP_URL ? { redirectUrl: `${env.WEB_APP_URL.replace(/\/$/, "")}/premium` } : {}),
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Referencia de pago aleatoria: `lk` + 24 caracteres en minúscula. */
export function newReference(
  random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b),
): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = random(new Uint8Array(24));
  return `lk${[...bytes].map((b) => alphabet[b % alphabet.length]).join("")}`;
}

/** Firma de integridad del checkout: SHA-256 de referencia + monto + moneda + secreto. */
export const integritySignature = (
  reference: string,
  amountInCents: bigint,
  currency: string,
  secret: string,
) => sha256Hex(`${reference}${amountInCents}${currency}${secret}`);

/** URL del checkout web de Wompi para un precio. */
export async function checkoutUrl(config: WompiConfig, reference: string, price: Price) {
  const amount = price.amount.amountMinor;
  const currency = price.amount.currencyCode;
  const params = new URLSearchParams({
    "public-key": config.publicKey,
    currency,
    "amount-in-cents": amount.toString(),
    reference,
    "signature:integrity": await integritySignature(
      reference,
      amount,
      currency,
      config.integritySecret,
    ),
  });
  if (config.redirectUrl) params.set("redirect-url", config.redirectUrl);
  return `${WOMPI_CHECKOUT_URL}?${params.toString()}`;
}

/** Lo que usamos del webhook `transaction.updated`. El resto (correo, medio de pago) se ignora. */
export interface WompiTransaction {
  readonly id: string;
  readonly reference: string;
  readonly status: string;
  readonly amountInCents: bigint;
  readonly currency: string;
}

export type WompiEvent =
  | { readonly kind: "transaction"; readonly transaction: WompiTransaction; readonly at: Date }
  | { readonly kind: "other" };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Valor de `data` en la ruta "transaction.amount_in_cents", como texto para el checksum. */
function valueAt(data: unknown, path: string): string | undefined {
  let current: unknown = data;
  for (const key of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return typeof current === "string" || typeof current === "number" ? String(current) : undefined;
}

const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/**
 * Verifica el checksum de un evento: SHA-256 de los valores de `signature.properties`, el
 * `timestamp` y el secreto de eventos. Devuelve el evento traducido, o `null` si la firma no
 * cuadra, falta algo o viene del otro ambiente (sandbox contra producción).
 */
export async function verifyEvent(body: unknown, config: WompiConfig): Promise<WompiEvent | null> {
  if (!isRecord(body) || !isRecord(body.signature)) return null;
  const { properties, checksum } = body.signature;
  const { timestamp, data, environment } = body;
  if (!Array.isArray(properties) || properties.length === 0 || typeof checksum !== "string")
    return null;
  if (typeof timestamp !== "number" || environment !== config.environment) return null;
  let concatenated = "";
  for (const property of properties) {
    if (typeof property !== "string") return null;
    const value = valueAt(data, property);
    if (value === undefined) return null;
    concatenated += value;
  }
  const expected = await sha256Hex(`${concatenated}${timestamp}${config.eventsSecret}`);
  if (!safeEqual(expected, checksum.toLowerCase())) return null;

  if (body.event !== "transaction.updated" || !isRecord(data) || !isRecord(data.transaction))
    return { kind: "other" };
  const t = data.transaction;
  if (
    typeof t.id !== "string" ||
    typeof t.reference !== "string" ||
    typeof t.status !== "string" ||
    typeof t.amount_in_cents !== "number" ||
    !Number.isSafeInteger(t.amount_in_cents) ||
    typeof t.currency !== "string"
  )
    return null;
  return {
    kind: "transaction",
    at: new Date(timestamp * 1000),
    transaction: {
      id: t.id,
      reference: t.reference,
      status: t.status,
      amountInCents: BigInt(t.amount_in_cents),
      currency: t.currency,
    },
  };
}

/** Pago iniciado en nuestro checkout, como quedó guardado. */
export interface Checkout {
  readonly reference: string;
  readonly userId: string;
  readonly priceId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
}

/**
 * Traduce una transacción aprobada a un evento de la saga. Solo `APPROVED` activa premium, y solo
 * si el monto y la moneda son los del checkout (nadie paga menos editando la URL). El periodo se
 * suma al que ya tenga vigente: pagar antes de que venza no hace perder días.
 */
export function approvedPayment(
  checkout: Checkout,
  transaction: WompiTransaction,
  at: Date,
  currentPeriodEnd: Date | undefined,
): SubscriptionCommand | null {
  if (transaction.status !== "APPROVED") return null;
  if (transaction.amountInCents !== checkout.amountMinor) return null;
  if (transaction.currency !== checkout.currency) return null;
  const price = findPrice(checkout.priceId);
  if (!price) return null;
  const from =
    currentPeriodEnd && currentPeriodEnd.getTime() > at.getTime() ? currentPeriodEnd : at;
  return {
    userId: checkout.userId,
    provider: "wompi",
    plan: price.plan,
    event: { type: "payment_succeeded", at, periodEnd: addPeriod(from, price.period) },
  };
}
