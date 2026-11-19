import type { ReceiptStore } from "./store";

/** En la web no hay base local ni recibos. */
export const receiptStore: ReceiptStore = {
  available: false,
  save: async () => {
    throw new Error("Recibos no disponibles en la web");
  },
  uriOf: () => "",
  remove: async () => undefined,
};
