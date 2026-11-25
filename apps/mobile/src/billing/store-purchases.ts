import { noStore, type StorePurchases } from "./store";

/** Web y pruebas: sin tienda. En Android se usa `store-purchases.native.ts`. */
export const storePurchases: StorePurchases = noStore;
