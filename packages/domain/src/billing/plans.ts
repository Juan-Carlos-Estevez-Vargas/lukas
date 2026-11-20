/**
 * Planes y lo que habilita cada uno (entitlements). La app y la API preguntan por funciones,
 * nunca por el nombre del plan: así un plan nuevo o una promoción no obliga a tocar cada pantalla.
 */
export const PLANS = ["free", "premium"] as const;
export type Plan = (typeof PLANS)[number];

/**
 * Funciones que dependen del plan. Las que gastan modelos de visión o embeddings son premium;
 * el chat del asistente es de todos, con una cuota diaria menor en el plan gratis.
 */
export const FEATURES = ["assistant", "receiptReading", "semanticSearch"] as const;
export type Feature = (typeof FEATURES)[number];

export interface Entitlements {
  readonly plan: Plan;
  readonly features: readonly Feature[];
  /** Tokens del asistente por día de Colombia. */
  readonly aiDailyTokens: number;
  /** Peticiones al asistente por día de Colombia. */
  readonly aiDailyRequests: number;
}

const CATALOG: Readonly<Record<Plan, Entitlements>> = {
  free: {
    plan: "free",
    features: ["assistant"],
    aiDailyTokens: 20_000,
    aiDailyRequests: 40,
  },
  premium: {
    plan: "premium",
    features: ["assistant", "receiptReading", "semanticSearch"],
    aiDailyTokens: 100_000,
    aiDailyRequests: 200,
  },
};

export const entitlementsOf = (plan: Plan): Entitlements => CATALOG[plan];

export const hasFeature = (entitlements: Entitlements, feature: Feature): boolean =>
  entitlements.features.includes(feature);

export const isPlan = (value: string): value is Plan =>
  (PLANS as readonly string[]).includes(value);

export const isFeature = (value: string): value is Feature =>
  (FEATURES as readonly string[]).includes(value);
