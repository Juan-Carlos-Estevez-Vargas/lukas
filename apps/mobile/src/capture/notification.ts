import type { RawCapture } from "./normalize";

/** Lo que entrega el lector de Android por cada aviso de una app permitida. */
export interface PostedNotification {
  readonly id: string;
  readonly app: string;
  readonly title: string;
  readonly text: string;
  /** Milisegundos desde 1970, la hora en que el banco publicó el aviso. */
  readonly postedAt: number;
}

// "$12.500", "$ 1.250.000,50", "COP 45.000", "45.000 pesos".
const AMOUNT =
  /(?:\$|cop)\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)|(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?)\s?(?:cop|pesos)\b/i;

// Solo avisos de plata que se movió; lo demás (promociones, códigos, recordatorios) se ignora.
const MOVEMENT =
  /compra|pag(o|aste|amos)|transfer|envi(o|aste|aron)|recib|retir|abono|consignaci|d[eé]bito|cargo|te (enviaron|transfirieron|pagaron)|nomina/i;
const NOT_MOVEMENT =
  /c[oó]digo|clave|otp|token|promo|oferta|descuento|gana|cashback|pr[eé]stamo pre|recuerda|vence|cupo disponible|inscrib/i;

// "Compraste en EXITO por $..." o "Pagaste $23.450 en ARA" → el comercio. Corta en "por", "el",
// "con", "desde" o puntuación (salvo la de un monto).
const MERCHANT =
  /(?:compra(?:ste)?|pag(?:o|aste))(?: aprobad[oa])?(?:\s+(?:de|por))?(?:\s+(?:\$|cop)?\s?[\d.,]+)?\s+(?:en|a)\s+(.+?)(?=\s+(?:por|el|con|desde|de tu|con tu)\b|[,;!]|\.(?!\d)|$)/i;

/**
 * Lectura genérica de un aviso bancario: monto, si es ingreso o gasto (lo deduce `normalize`) y el
 * comercio cuando sigue a "compra en" o "pago a". `null` si no parece un movimiento.
 */
export function parseNotification(n: PostedNotification): RawCapture | null {
  const text = `${n.title}. ${n.text}`.replace(/\s+/g, " ").trim();
  if (!MOVEMENT.test(text) || NOT_MOVEMENT.test(text)) return null;
  const m = AMOUNT.exec(text);
  const amount = m?.[1] ?? m?.[2];
  if (!amount) return null;
  return {
    source: "notification",
    app: n.app,
    receivedAt: new Date(n.postedAt),
    amount,
    merchant: MERCHANT.exec(n.text)?.[1] ?? MERCHANT.exec(text)?.[1] ?? null,
    text,
  };
}
