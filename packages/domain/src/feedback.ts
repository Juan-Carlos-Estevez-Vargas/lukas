/**
 * Comentarios de la beta (FIN-408): qué tipo de mensaje es y cómo se limpia antes de enviarlo
 * o guardarlo. Ni la app ni la API guardan números de tarjeta, aunque la persona los escriba.
 */
export const FEEDBACK_KINDS = ["bug", "idea", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_MIN_LENGTH = 5;
export const FEEDBACK_MAX_LENGTH = 2000;

export const isFeedbackKind = (value: string): value is FeedbackKind =>
  (FEEDBACK_KINDS as readonly string[]).includes(value);

/** Algoritmo de Luhn: el dígito de control de las tarjetas. */
export function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return digits.length > 0 && sum % 10 === 0;
}

// 13 a 19 dígitos, con espacios o guiones sueltos entre ellos.
const CARD_LIKE = /\d(?:[ -]?\d){12,18}/g;

/** Cambia por "[tarjeta]" toda secuencia que parezca un número de tarjeta válido. */
export function maskCardNumbers(text: string): string {
  return text.replace(CARD_LIKE, (match) =>
    passesLuhn(match.replace(/\D/g, "")) ? "[tarjeta]" : match,
  );
}

/** Texto listo para guardar: sin espacios sobrantes ni tarjetas, o `null` si es muy corto o largo. */
export function cleanFeedback(text: string): string | null {
  const clean = maskCardNumbers(
    text
      .normalize("NFC")
      .trim()
      .replace(/\n{3,}/g, "\n\n"),
  );
  if (clean.length < FEEDBACK_MIN_LENGTH || clean.length > FEEDBACK_MAX_LENGTH) return null;
  return clean;
}
