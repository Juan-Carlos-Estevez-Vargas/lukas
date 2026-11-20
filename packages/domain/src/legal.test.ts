import { describe, expect, it } from "vitest";
import { isLegalDocument, LEGAL_DOCUMENTS, LEGAL_VERSIONS, pendingConsents } from "./legal";

describe("documentos legales", () => {
  it("pide todo a quien no ha aceptado nada y nada a quien aceptó lo vigente", () => {
    expect(pendingConsents([])).toEqual(["privacy", "terms"]);
    const all = LEGAL_DOCUMENTS.map((document) => ({
      document,
      version: LEGAL_VERSIONS[document],
    }));
    expect(pendingConsents(all)).toEqual([]);
  });

  it("una versión vieja no cuenta", () => {
    expect(
      pendingConsents([
        { document: "privacy", version: "2020-01-01" },
        { document: "terms", version: LEGAL_VERSIONS.terms },
      ]),
    ).toEqual(["privacy"]);
  });

  it("las versiones son fechas y los nombres se validan", () => {
    for (const v of Object.values(LEGAL_VERSIONS)) expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(isLegalDocument("privacy")).toBe(true);
    expect(isLegalDocument("cookies")).toBe(false);
  });
});
