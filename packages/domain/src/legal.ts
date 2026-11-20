/**
 * Documentos legales que la persona acepta al registrarse (FIN-407, Ley 1581 de 2012). Cada
 * cambio de texto sube la versión y vuelve a pedir la autorización.
 */
export const LEGAL_DOCUMENTS = ["privacy", "terms"] as const;
export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];

/** Versión vigente de cada documento: la fecha en que entró a regir, "AAAA-MM-DD". */
export const LEGAL_VERSIONS: Readonly<Record<LegalDocument, string>> = {
  privacy: "2026-11-20",
  terms: "2026-11-20",
};

export interface LegalConsent {
  readonly document: LegalDocument;
  readonly version: string;
}

export const isLegalDocument = (value: string): value is LegalDocument =>
  (LEGAL_DOCUMENTS as readonly string[]).includes(value);

/** Documentos cuya versión vigente la persona todavía no ha aceptado. */
export const pendingConsents = (accepted: readonly LegalConsent[]): LegalDocument[] =>
  LEGAL_DOCUMENTS.filter(
    (doc) => !accepted.some((c) => c.document === doc && c.version === LEGAL_VERSIONS[doc]),
  );
