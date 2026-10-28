import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { categories } from "../schema";

type CategoryKind = (typeof categories.$inferInsert)["kind"];

interface CategorySeed {
  readonly name: string;
  readonly kind: CategoryKind;
  readonly icon: string;
  readonly children?: readonly string[];
  readonly system?: boolean;
}

/** Categorías iniciales pensadas para Colombia. El usuario puede renombrarlas o archivarlas. */
export const DEFAULT_CATEGORIES: readonly CategorySeed[] = [
  { name: "Salario", kind: "income", icon: "briefcase" },
  { name: "Honorarios", kind: "income", icon: "receipt" },
  { name: "Intereses y rendimientos", kind: "income", icon: "trending-up" },
  { name: "Otros ingresos", kind: "income", icon: "plus-circle" },
  {
    name: "Hogar",
    kind: "expense",
    icon: "home",
    children: ["Arriendo", "Administración", "Servicios públicos", "Internet y celular"],
  },
  {
    name: "Alimentación",
    kind: "expense",
    icon: "shopping-cart",
    children: ["Mercado", "Restaurantes", "Domicilios"],
  },
  {
    name: "Transporte",
    kind: "expense",
    icon: "bus",
    children: ["Transporte público", "Taxi y apps", "Gasolina", "Parqueadero", "Peajes"],
  },
  { name: "Salud", kind: "expense", icon: "heart", children: ["EPS y prepagada", "Droguería"] },
  { name: "Educación", kind: "expense", icon: "book" },
  {
    name: "Entretenimiento",
    kind: "expense",
    icon: "film",
    children: ["Suscripciones", "Salidas"],
  },
  { name: "Compras", kind: "expense", icon: "shopping-bag", children: ["Ropa", "Tecnología"] },
  {
    name: "Finanzas",
    kind: "expense",
    icon: "landmark",
    children: ["4×1000", "Comisiones bancarias", "Intereses de tarjeta", "Impuestos"],
  },
  { name: "Otros gastos", kind: "expense", icon: "more-horizontal" },
  { name: "Saldo inicial", kind: "equity", icon: "flag", system: true },
  { name: "Cambio de divisas", kind: "trading", icon: "repeat", system: true },
];

/** Crea las categorías por defecto de un usuario en una sola transacción. */
export const seedDefaultCategories = async <
  TQueryResult extends PgQueryResultHKT,
  TSchema extends Record<string, unknown>,
>(
  db: PgDatabase<TQueryResult, TSchema>,
  userId: string,
  newId: () => string,
): Promise<number> => {
  const rows: (typeof categories.$inferInsert)[] = [];
  for (const seed of DEFAULT_CATEGORIES) {
    const parentId = newId();
    rows.push({
      id: parentId,
      userId,
      name: seed.name,
      kind: seed.kind,
      icon: seed.icon,
      isSystem: seed.system ?? false,
    });
    for (const child of seed.children ?? []) {
      rows.push({ id: newId(), userId, parentId, name: child, kind: seed.kind });
    }
  }
  await db.transaction(async (tx) => {
    await tx.insert(categories).values(rows);
  });
  return rows.length;
};
