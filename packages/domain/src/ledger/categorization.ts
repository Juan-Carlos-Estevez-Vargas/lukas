import { merchantKey } from "./movement";

/**
 * Regla de categorización. `merchant` compara el comercio completo (normalizado); `keyword` busca
 * la palabra dentro del comercio o la nota. Las reglas `user` las escribe la persona; las
 * `learned` salen de sus correcciones.
 */
export interface CategoryRule {
  readonly id: string;
  readonly match: "merchant" | "keyword";
  readonly pattern: string;
  readonly categoryId: string;
  readonly source: "user" | "learned";
  readonly updatedAt: Date;
}

export interface RuleInput {
  readonly merchant: string | null;
  readonly note?: string | null;
}

const rank = (r: CategoryRule): number =>
  (r.source === "user" ? 0 : 2) + (r.match === "merchant" ? 0 : 1);

/**
 * Elige la regla que aplica: primero las de la persona sobre las aprendidas, luego comercio exacto
 * sobre palabra clave, luego la palabra más larga (más específica) y por último la más reciente.
 */
export function matchRule(rules: readonly CategoryRule[], input: RuleInput): CategoryRule | null {
  const merchant = merchantKey(input.merchant ?? "");
  const haystack = ` ${merchant} ${merchantKey(input.note ?? "")} `;
  const hits = rules.filter((r) => {
    const pattern = merchantKey(r.pattern);
    if (pattern.length === 0) return false;
    return r.match === "merchant" ? pattern === merchant : haystack.includes(` ${pattern} `);
  });
  hits.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      merchantKey(b.pattern).length - merchantKey(a.pattern).length ||
      b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  return hits[0] ?? null;
}

/**
 * Cuando la persona cambia la categoría sugerida para un comercio, se aprende: la próxima vez ese
 * comercio sale con la categoría que eligió. Devuelve `null` si no hay nada que aprender.
 */
export function learnFromCorrection(
  merchant: string | null,
  suggested: string | null,
  chosen: string,
): { readonly pattern: string; readonly categoryId: string } | null {
  const pattern = merchantKey(merchant ?? "");
  if (pattern.length === 0 || suggested === chosen) return null;
  return { pattern, categoryId: chosen };
}
