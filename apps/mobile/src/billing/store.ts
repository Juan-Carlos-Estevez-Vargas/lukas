/**
 * Compras dentro de la app en Android (FIN-403): Google Play a través de RevenueCat. Este archivo
 * tiene el puerto y la lógica que no depende del SDK; `store-purchases*.ts` lo implementan.
 */
export interface StorePackage {
  readonly id: string;
  /** Precio ya formateado por la tienda (moneda y país de la cuenta de Google). */
  readonly priceText: string;
  readonly period: "month" | "year" | "other";
}

export type PurchaseResult = "purchased" | "cancelled" | "failed";
export type RestoreResult = "restored" | "none" | "failed";

export interface StorePurchases {
  /** Hay tienda configurada en este teléfono (Android con llave de RevenueCat). */
  readonly available: boolean;
  /** Ata las compras a la persona: el webhook usa este id para activar premium. */
  connect(userId: string): Promise<void>;
  packages(): Promise<StorePackage[]>;
  purchase(packageId: string): Promise<PurchaseResult>;
  restore(): Promise<RestoreResult>;
}

/** Tienda apagada: web, builds sin llave o pruebas de extremo a extremo. */
export const noStore: StorePurchases = {
  available: false,
  connect: async () => undefined,
  packages: async () => [],
  purchase: async () => "failed",
  restore: async () => "failed",
};

/** Traduce el tipo de paquete de RevenueCat ("MONTHLY", "ANNUAL", …). */
export function periodOf(packageType: string): StorePackage["period"] {
  if (packageType === "MONTHLY") return "month";
  if (packageType === "ANNUAL") return "year";
  return "other";
}

/** Primero el mensual, luego el anual, y nada más: son los dos precios de Lukas. */
export const sortPackages = (packages: readonly StorePackage[]): StorePackage[] =>
  packages
    .filter((p) => p.period !== "other")
    .sort((a, b) => (a.period === b.period ? 0 : a.period === "month" ? -1 : 1));

/**
 * El webhook de RevenueCat tarda unos segundos en llegar a la API. Después de comprar o
 * restaurar, pregunta hasta `tries` veces si ya es premium.
 */
export async function waitForPremium(
  check: () => Promise<boolean>,
  { tries = 6, delayMs = 2000, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)) } = {},
): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return true;
    if (i < tries - 1) await sleep(delayMs);
  }
  return false;
}
