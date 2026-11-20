import type { CivilDate, CurrencyCode } from "@lukas/domain";
import { PdfError } from "../pdf/syntax";
import { readPdfLines } from "../pdf/text";
import { parseStatement, type Statement } from "./parse";

export type StatementResult =
  | { readonly ok: true; readonly statement: Statement }
  | { readonly ok: false; readonly reason: "password" | "invalid" | "unsupported" | "empty" };

/** `%PDF-` en el primer kilobyte (algunos archivos traen basura antes). */
export function looksLikePdf(data: Uint8Array): boolean {
  const head = String.fromCharCode(...data.subarray(0, 1024));
  return head.includes("%PDF-");
}

/**
 * Lee un extracto en PDF. La clave, si la hay, solo se usa aquí: no se guarda ni se registra.
 * `empty` si el PDF se abre pero no tiene movimientos legibles (p. ej. es una imagen escaneada).
 */
export function readStatement(
  data: Uint8Array,
  password: string,
  currency: CurrencyCode,
  today: CivilDate,
): StatementResult {
  try {
    const statement = parseStatement(readPdfLines(data, password), currency, today);
    if (statement.rows.length === 0) return { ok: false, reason: "empty" };
    return { ok: true, statement };
  } catch (e) {
    if (e instanceof PdfError) return { ok: false, reason: e.reason };
    return { ok: false, reason: "invalid" };
  }
}

/** Qué parte de las líneas con fecha se pudo leer (la meta es 90 % o más). */
export const readRate = (s: Statement): number =>
  s.rows.length / Math.max(1, s.rows.length + s.skipped);
