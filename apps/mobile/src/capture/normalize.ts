import { type CurrencyCode, type Money, type MovementKind, merchantKey } from "@lukas/domain";
import { parseAmount } from "../import/columns";

export type CaptureSource = "notification" | "email" | "statement";

/**
 * Lo que entrega un lector (notificación, correo, extracto) antes de normalizar. Los lectores de
 * cada banco (FIN-303) llenan lo que puedan; el resto se deduce del texto.
 */
export interface RawCapture {
  readonly source: CaptureSource;
  /** Paquete de la app o remitente del correo, para saber de qué banco viene. */
  readonly app?: string | null;
  readonly receivedAt: Date;
  /** Si el lector no trae hora, se usa la de llegada. */
  readonly occurredAt?: Date | null;
  readonly amount: string | Money;
  readonly currency?: CurrencyCode;
  readonly kind?: MovementKind | null;
  readonly merchant?: string | null;
  readonly last4?: string | null;
  /** Texto de la notificación o del asunto. Se usa para deducir y no se guarda. */
  readonly text?: string | null;
}

export interface Capture {
  readonly source: CaptureSource;
  readonly app: string | null;
  readonly receivedAt: Date;
  readonly occurredAt: Date;
  readonly kind: MovementKind;
  /** Siempre positivo; el signo lo da `kind`. */
  readonly amount: Money;
  readonly merchant: string | null;
  readonly last4: string | null;
}

// Lo que los bancos anteponen al comercio y no es parte de su nombre.
const PREFIXES =
  /^(compra( aprobada)?( en| por)?|pago( aprobado)?( en| a)?|pagaste( en| a)?|compraste( en)?|transferencia( a| de)?|envio( a)?|enviaste( a)?|recibiste( de)?|abono( de)?|retiro( en)?)\s+/i;

const INCOME = /recib|abono|consignaci|te enviaron|te transfiri|ingreso|devoluci|reintegro|nomina/i;

/** "Compra en RAPPI*RESTAURANTE" → "Rappi*Restaurante": quita prefijos y el grito de mayúsculas. */
export function cleanMerchant(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(PREFIXES, "")
    .replace(/[.,;:]+$/, "")
    .trim();
  if (!text || !/\p{L}/u.test(text)) return null;
  // Los bancos suelen gritar ("EXITO CALLE 80"): solo entonces se pasa a "Exito Calle 80".
  if (text !== text.toUpperCase()) return text;
  return text
    .toLowerCase()
    .replace(/(^|[\s*/-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Últimos 4 dígitos de tarjeta o cuenta: "*1234", "terminada en 1234", "**** 1234". */
export function findLast4(text: string | null | undefined): string | null {
  if (!text) return null;
  const m =
    /(?:terminad[ao] en|finalizad[ao] en|\*+\s?|x{2,}\s?|tarjeta|cuenta)\D{0,4}(\d{4})\b/i.exec(
      text,
    );
  return m?.[1] ?? null;
}

/** Valida y completa una captura; `null` si no tiene un monto positivo legible. */
export function normalizeCapture(raw: RawCapture): Capture | null {
  const currency = raw.currency ?? "COP";
  const parsed = typeof raw.amount === "string" ? parseAmount(raw.amount, currency) : raw.amount;
  if (!parsed || parsed.isZero() || parsed.currencyCode !== currency) return null;
  const amount = parsed.isNegative() ? parsed.negate() : parsed;
  const kind =
    raw.kind ??
    (parsed.isNegative() ? "expense" : INCOME.test(raw.text ?? "") ? "income" : "expense");
  const last4 = raw.last4 && /^\d{4}$/.test(raw.last4) ? raw.last4 : findLast4(raw.text);
  return {
    source: raw.source,
    app: raw.app ?? null,
    receivedAt: raw.receivedAt,
    occurredAt: raw.occurredAt ?? raw.receivedAt,
    kind,
    amount,
    merchant: cleanMerchant(raw.merchant),
    last4,
  };
}

const TEN_MINUTES = 10 * 60_000;

/**
 * Huella exacta: tipo, moneda, monto, tarjeta y franja de 10 minutos. Dos vías que reportan la
 * misma compra en la misma franja dan la misma huella; las que caen en franjas vecinas las
 * encuentra `sameMovement`.
 */
export const fingerprint = (c: Capture): string =>
  [
    c.kind,
    c.amount.currencyCode,
    c.amount.amountMinor.toString(),
    c.last4 ?? "-",
    Math.floor(c.occurredAt.getTime() / TEN_MINUTES),
  ].join("|");

/** Ventana para considerar que dos avisos son la misma compra. */
export const SAME_WINDOW_MS = 15 * 60_000;

const tokens = (name: string | null): Set<string> =>
  new Set(
    merchantKey(name ?? "")
      .split(" ")
      .filter((t) => t.length >= 3),
  );

/** Los nombres se parecen si comparten una palabra ("RAPPI*RESTAURANTE" y "Rappi"). */
export function similarMerchants(a: string | null, b: string | null): boolean {
  if (!a || !b) return true;
  const ta = tokens(a);
  return [...tokens(b)].some(
    (t) => ta.has(t) || [...ta].some((x) => x.startsWith(t) || t.startsWith(x)),
  );
}

/**
 * ¿Son la misma compra? Mismo tipo y monto, a menos de 15 minutos (o el mismo día si una viene de
 * un extracto, que no trae hora), y sin contradecirse en la tarjeta. Si alguna no sabe la tarjeta,
 * además deben parecerse los comercios.
 */
export function sameMovement(a: Capture, b: Capture): boolean {
  if (a.kind !== b.kind || a.amount.currencyCode !== b.amount.currencyCode) return false;
  if (!a.amount.equals(b.amount)) return false;
  const statement = a.source === "statement" || b.source === "statement";
  const close = statement
    ? a.occurredAt.toDateString() === b.occurredAt.toDateString()
    : Math.abs(a.occurredAt.getTime() - b.occurredAt.getTime()) <= SAME_WINDOW_MS;
  if (!close) return false;
  if (a.last4 && b.last4) return a.last4 === b.last4;
  return similarMerchants(a.merchant, b.merchant);
}
