import type { AccountType } from "@lukas/domain";

export type TemplateKey =
  | "cash"
  | "nequi"
  | "daviplata"
  | "bancolombia"
  | "nu"
  | "lulo"
  | "credit_card"
  | "savings";

export interface AccountTemplate {
  readonly key: TemplateKey;
  readonly name: string;
  readonly type: AccountType;
  readonly institution: string | null;
}

/**
 * Plantillas con lo más usado en Colombia: un toque crea la cuenta con nombre, tipo y entidad.
 * Nunca se pide el número de cuenta ni de tarjeta.
 */
export const ACCOUNT_TEMPLATES: readonly AccountTemplate[] = [
  { key: "cash", name: "Efectivo", type: "cash", institution: null },
  { key: "nequi", name: "Nequi", type: "digital_wallet", institution: "Nequi" },
  { key: "daviplata", name: "Daviplata", type: "digital_wallet", institution: "Daviplata" },
  { key: "bancolombia", name: "Bancolombia", type: "bank", institution: "Bancolombia" },
  { key: "nu", name: "Nu", type: "bank", institution: "Nu Colombia" },
  { key: "lulo", name: "Lulo Bank", type: "bank", institution: "Lulo Bank" },
  { key: "credit_card", name: "Tarjeta de crédito", type: "credit_card", institution: null },
  { key: "savings", name: "Ahorros", type: "other_asset", institution: null },
];

export const templateByKey = (key: string): AccountTemplate | undefined =>
  ACCOUNT_TEMPLATES.find((t) => t.key === key);

/** Grupos para mostrar las cuentas: se derivan del tipo, sin que el usuario tenga que armarlos. */
export type AccountGroup = "cash" | "wallets" | "banks" | "cards" | "debts" | "investments";

export function groupOf(type: AccountType): AccountGroup {
  switch (type) {
    case "cash":
      return "cash";
    case "digital_wallet":
      return "wallets";
    case "bank":
      return "banks";
    case "credit_card":
      return "cards";
    case "loan":
    case "other_liability":
      return "debts";
    case "investment":
    case "other_asset":
      return "investments";
  }
}

export const GROUP_ORDER: readonly AccountGroup[] = [
  "cash",
  "wallets",
  "banks",
  "cards",
  "investments",
  "debts",
];

/** Agrupa en el orden de `GROUP_ORDER`, omitiendo los grupos vacíos. */
export function groupAccounts<T extends { readonly account: { readonly type: AccountType } }>(
  rows: readonly T[],
): { group: AccountGroup; rows: T[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    rows: rows.filter((r) => groupOf(r.account.type) === group),
  })).filter((g) => g.rows.length > 0);
}
