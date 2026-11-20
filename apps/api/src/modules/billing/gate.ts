import { type Entitlements, type Feature, hasFeature } from "@lukas/domain";
import { HttpProblem } from "../../http/problem";

/** Corta la petición con 402 si el plan de la persona no incluye la función. */
export function requireFeature(entitlements: Entitlements, feature: Feature): void {
  if (hasFeature(entitlements, feature)) return;
  throw new HttpProblem(
    402,
    "premium_required",
    "Esta función es de Lukas Premium",
    `Tu plan (${entitlements.plan}) no incluye ${feature}.`,
  );
}
